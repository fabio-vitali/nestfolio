# Fund-account feature — design

**Status:** Proposed
**Author:** fabio-vitali + Claude
**Date:** 2026-04-22
**Blocks:** [Playwright UI e2e](./2026-04-22-playwright-e2e-ui-design.md) Phase 1 journey step 7

## Why this spec exists

The Playwright spec's 2026-04-22 survey confirmed that no fund-account / deposit UI exists in any MFE today (`apps/investor-mfe/src/app` has only `go-live-wizard` + `notifications`; `apps/dashboard-mfe/src/app/dashboard` has no deposit UI). Journey step 7 — "Navigate to investor → fund account" — is currently blocked behind net-new UI work. The parent spec deferred the choice to build vs. drop; this spec builds.

**Backend is already complete.** Discovery during brainstorm confirmed the entire server-side deposit pipeline is shipped:

- `services/investor/investor-bff/src/schema.graphql:13` — `initiateDeposit(input: DepositInput!): DepositIntent!` mutation.
- `services/investor/investor-bff/src/graphql/js-function/initiate-deposit.fn.js` — live JS resolver with `check-feature-flag.fn.js` gate.
- Egress CDC publishes `DEPOSIT_INITIATED` on insert (`service.stack.ts:73`).
- `broker-ctrl` routes → `broker-sim-adpt` simulates → emits `DEPOSIT_DETECTED`.
- `ledger-ctrl` consumes `DEPOSIT_DETECTED` → appends `LedgerEntry` + emits `BALANCE_UPDATED`.
- `dashboard-bff` projects `DEPOSIT_DETECTED` → activity feed + cash balance (`transforms/recent-activity.ts:9`).
- Feature flag `initiateDeposit` is already wired through the circuit-breaker (proved by `apps/e2e-feature-tests/src/account/circuit-breaker-lifecycle.e2e.test.ts`).

This spec therefore covers **frontend affordances plus a small backend addition**: a GraphQL subscription so the user sees deposit confirmation in real time.

## Goals

- Give an onboarded investor a user-initiated path to add cash to their account.
- Give the user a real-time, in-page confirmation when the deposit is detected by the backend (no manual refresh, no silent "hope it worked").
- Compose with the existing circuit-breaker feature flag (`initiateDeposit`) so deposits are paused when the broker is down.
- Unblock Playwright journey steps 7 and 8.

## Non-goals

- Withdrawal UI. `requestWithdrawal` is wired on the backend; its UI is a separate spec.
- Multi-currency support. The backend accepts `currency` but only USD is exercised end-to-end. Phase 1 locks currency to USD.
- External payment rails (Plaid, bank linking). Sim broker is the only pipeline today.
- Historical deposits list / "My deposits" page. Out of scope; future polish.
- Changes to the existing `initiate-deposit.fn.js` resolver, broker-ctrl routing, broker-sim simulation, ledger-ctrl ingestion, or dashboard-bff projection. All complete.

## High-level decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| MFE ownership | Split: CTA on dashboard-mfe; form + status panel on investor-mfe | Dashboard has cash balance (natural entry); investor-mfe owns profile-level actions (DDD fit). Exercises federation in the Playwright journey. |
| Form factor | Dedicated route `/investor/deposit` | Deep-linkable, own POM, room for status panel UI. Modal was considered and rejected. |
| Form fields | Amount only (USD hardcoded) | Minimum viable. Currency rendered read-only. |
| Post-submit behavior | Stay on `/investor/deposit` + live status panel | Keeps the user in context until the backend confirms. User navigates back manually via CTA. |
| Status transport | GraphQL subscription on investor-bff | Reuses the existing pattern (`onFeatureFlagUpdate` subscription triggered by IAM-signed `updateFeatureFlag` mutation from the event-listener Lambda). Same primitives, new entity. |
| Feature-flag awareness | Dashboard CTA + form both reactive to `initiateDeposit` flag | Uses the existing `libs/ui/feature-flags` signal store. |

## Architecture

### Dashboard CTA (dashboard-mfe)

Single new affordance, on the cash-balance KPI card.

- Location: `apps/dashboard-mfe/src/app/dashboard/kpi-cards.component.ts` — the component that renders `cashBalanceCents`. Add a PrimeNG `p-button` beside the figure.
- Label: "Deposit". Small, outlined, `data-testid="cta-deposit"`.
- Action: `this.router.navigate(['/investor/deposit'])`. Host's `app.routes.ts` already routes `/investor/**` to the investor-mfe remote entry — no host route change required if the `/deposit` segment resolves through the remote route table.
- Feature-flag reactivity: subscribes to `FeatureFlagStore`; when `initiateDeposit.enabled === false`, button is disabled with PrimeNG tooltip "Deposits paused — the brokerage circuit is open." (Matches the CB UX used on other flag-gated controls.)
- No state, no store — pure derived-signal binding.

### `/investor/deposit` route (investor-mfe)

New component, new folder.

**Files:**
- `apps/investor-mfe/src/app/deposit/deposit-page.component.ts` — standalone component.
- `apps/investor-mfe/src/app/deposit/deposit-page.component.spec.ts` — unit tests.
- `apps/investor-mfe/src/app/app.routes.ts` — currently empty, add `{ path: 'deposit', loadComponent: () => import('./deposit/deposit-page.component').then(m => m.DepositPageComponent) }`.
- `apps/investor-mfe/src/app/remote-routes.ts` — expose the new path in the federation remote route table.

No host-shell route change is needed: investor-mfe is already federated under `/investor/*` and its remote-routes.ts is the authoritative source.

### Page states

The page renders one of five states, all backed by a single `DepositPageState` signal on the component:

| State | Trigger | Content | `data-testid` |
|---|---|---|---|
| `form` | initial load | Amount input + Confirm/Cancel | `deposit-form` |
| `submitting` | Confirm clicked, mutation in flight | Spinner, inputs locked | `deposit-submitting` |
| `initiated` | mutation resolved with `status: 'INITIATED'`; subscription open | Deposit ID, amount, status badge, "We'll update this page the moment your deposit is confirmed." | `deposit-panel-initiated` |
| `detected` | subscription delivered `{ status: 'DETECTED' }` | Success state, status badge, CTA "View on dashboard" | `deposit-panel-detected` |
| `failed` | subscription delivered `{ status: 'FAILED' }` OR mutation threw `FeatureFlagDisabledError` | Error reason + CTA "Try again" (returns to `form`) | `deposit-panel-failed` |
| `timeout` | 30s elapsed in `initiated` with no further update | Persistent "Still processing…" banner; subscription stays open; no state reset | `deposit-panel-timeout` |

Transitions:
- `form` → `submitting` on Confirm.
- `submitting` → `initiated` on mutation success.
- `submitting` → `failed` on mutation error.
- `initiated` → `detected` on subscription payload where `status === 'DETECTED'`.
- `initiated` → `failed` on subscription payload where `status === 'FAILED'`.
- `initiated` → `timeout` after 30s without transition (a derived `effect()` or `setTimeout` with cleanup).
- `timeout` → `detected`/`failed` if the subscription later delivers.
- `failed` → `form` on "Try again".

### Form details

- Amount: PrimeNG `p-inputNumber`, `mode="currency"`, `currency="USD"`, `locale="en-US"`, `min=1`, `max=10000000`. Client-side: multiply by 100 to get cents. `data-testid="deposit-amount"`.
- Currency: read-only label "USD". `data-testid="deposit-currency"`.
- Confirm button: `data-testid="deposit-confirm"`. Disabled while amount is empty/invalid or the `initiateDeposit` feature flag is disabled.
- Cancel button: `data-testid="deposit-cancel"`. Navigates to `/dashboard`.
- Feature-flag banner: when flag disabled, a `p-message severity="warn"` renders above the form with `reason` field from the flag store. Confirm is disabled.

No custom form library — plain Angular reactive forms (already used by the go-live wizard in investor-mfe).

### Status panel details

- Status badge: color-coded PrimeNG `p-tag` — blue (`INITIATED`), green (`DETECTED`), red (`FAILED`).
- Deposit ID: rendered as copyable monospace text.
- Amount: formatted via Angular `CurrencyPipe` (USD locale) from cents.
- Timestamps: formatted via `DatePipe` from `initiatedAt` (from mutation response) and, on `detected`, from the subscription's `occurredAt`.
- "View on dashboard" CTA (in `detected` state): `data-testid="deposit-back"`, `router.navigate(['/dashboard'])`.

### Apollo wiring

Two new files under `apps/investor-mfe/src/app/graphql/`:

```ts
// investor-bff.mutations.ts (new)
export const INITIATE_DEPOSIT = gql`
  mutation InitiateDeposit($input: DepositInput!) {
    initiateDeposit(input: $input) {
      depositId amountCents currency status initiatedAt
    }
  }
`;
```

```ts
// investor-bff.subscriptions.ts (new)
export const ON_DEPOSIT_EVENT = gql`
  subscription OnDepositEvent($depositId: ID!) {
    onDepositEvent(depositId: $depositId) {
      depositId tenantId status amountCents currency occurredAt reason
    }
  }
`;
```

The investor-mfe Apollo client is already configured with an AppSync WebSocket subscription link (the Facade already hosts `onNotification`). No new client config required — just new operation documents.

### State and lifecycle in the component

- Signal-based component state — consistent with recently added stores (e.g., `libs/ui/feature-flags`). No new NgRx SignalStore.
- `DepositPageComponent`:
  - `state = signal<DepositPageState>('form')`.
  - `depositIntent = signal<DepositIntent | null>(null)` — populated on mutation success.
  - `depositEvent = signal<DepositEvent | null>(null)` — populated on subscription payloads.
  - `timeoutId: number | null` — managed in `effect()` with cleanup.
  - `subscription: Subscription | null` — unsubscribed in `ngOnDestroy`.

No persistence across navigations. Leaving the page closes the subscription. Returning with the same `depositId` is not supported in Phase 1 (no `?depositId=` query param); a fresh deposit always starts in `form`.

## Backend addition — subscription pipeline

The key server-side change is enabling real-time confirmation. No other backend change.

### Pattern reference

`services/investor/investor-bff/CLAUDE.md` describes the pattern already used for `BROKER_CIRCUIT_OPEN` → `updateFeatureFlag` via IAM-signed AppSync mutation. The deposit-event subscription follows the same shape. investor-bff's Facade already has `enableIamAuth: true` — no construct change.

### GraphQL schema additions (`services/investor/investor-bff/src/schema.graphql`)

```graphql
enum DepositStatus {
  INITIATED
  DETECTED
  FAILED
}

type DepositEvent @aws_cognito_user_pools @aws_iam {
  depositId: ID!
  tenantId: ID!
  status: DepositStatus!
  amountCents: Int!
  currency: String!
  occurredAt: String!
  reason: String
}

input DepositEventInput {
  depositId: ID!
  tenantId: ID!
  status: DepositStatus!
  amountCents: Int!
  currency: String!
  occurredAt: String!
  reason: String
}

# Appended to the existing Mutation type
extend type Mutation {
  publishDepositEvent(input: DepositEventInput!): DepositEvent!
    @aws_iam
}

# Appended to the existing Subscription type
extend type Subscription {
  onDepositEvent(depositId: ID!): DepositEvent
    @aws_subscribe(mutations: ["publishDepositEvent"])
}
```

Argument filtering: AppSync filters subscription delivery by matching the client-supplied `depositId` argument against the mutation's return-value `depositId`. Standard AppSync behavior — no custom resolver plumbing needed.

### New JS resolver (`publish-deposit-event.fn.js`)

Location: `services/investor/investor-bff/src/graphql/js-function/publish-deposit-event.fn.js`.

Responsibility:
- Persist the status transition on the existing `DepositIntent` row (`UpdateItem` with `attribute_exists(pk)` condition — avoid creating orphan rows if the row was cleaned up).
- Return the `DepositEvent` shape (triggers the subscription).
- IAM-auth only (resolver `@aws_iam`).

### Event-listener extension (`services/investor/investor-bff/src/handlers/event-listener.ts`)

Extend the existing handler map with `DEPOSIT_DETECTED`:

1. Match by `depositId` from the event payload.
2. Fire IAM-signed GraphQL mutation `publishDepositEvent(input: { depositId, tenantId, status: 'DETECTED', amountCents, currency, occurredAt })` using the existing AppSync IAM client (same helper used for `updateFeatureFlag`).

No new Lambda. No new CDK resource. Adds:
- An entry in the handler map.
- Subscription of the listener's SQS to `DEPOSIT_DETECTED` via the investor-adpt adapter rules (the investor-adpt already lists `DEPOSIT_DETECTED` — `services/investor/investor-adpt/src/domain/events.ts:40` — so routing is in place; the listener just needs to consume it).

### FAILED status — deferred emission

No `DEPOSIT_FAILED` / `DEPOSIT_REJECTED` event exists on the bus today. The `FAILED` status is defined in the schema and handled by the client UI, but nothing emits it in Phase 1. Failure is observed via:

- Synchronous mutation error (feature-flag disabled): client transitions to `failed` on the mutation's error branch, not via subscription.
- Timeout: client transitions to `timeout` after 30s with no subscription payload; does not mean failure.

Backend `FAILED` emission is a follow-up once a broker rejection event type is introduced. Out of scope here.

## Testing

### Unit tests (frontend)

`apps/investor-mfe/test/app/deposit/deposit-page.component.spec.ts`:
- `form` state renders amount + Confirm/Cancel.
- Confirm disabled when amount empty, `initiateDeposit` flag disabled, or mutation in flight.
- Mutation success transitions `submitting` → `initiated` and starts subscription.
- Subscription payload `{ status: 'DETECTED' }` transitions `initiated` → `detected`.
- 30s elapsed transitions `initiated` → `timeout`.
- `FeatureFlagDisabledError` from mutation transitions `submitting` → `failed`.
- Cancel navigates to `/dashboard`.
- "Try again" from `failed` returns to `form`.

`apps/dashboard-mfe/test/app/dashboard/kpi-cards.component.spec.ts`:
- Deposit button renders with `data-testid="cta-deposit"`.
- Button disabled when `initiateDeposit` flag is `enabled: false`.
- Click navigates to `/investor/deposit`.

### Unit tests (backend)

`services/investor/investor-bff/test/unit/graphql/publish-deposit-event.test.ts`:
- Resolver happy path: valid input writes to DDB + returns the event shape.
- Resolver rejects when `attribute_exists(pk)` condition fails.

`services/investor/investor-bff/test/unit/handlers/event-listener.test.ts` (extended):
- `DEPOSIT_DETECTED` event triggers `publishDepositEvent` mutation call with the correct arguments.

### Integration test (investor-bff)

Extend `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`:
- Full round trip: emit `DEPOSIT_DETECTED` → assert the DDB row's status advances to `DETECTED` → assert a mutation was fired (observed via trace trap / mock).

Real end-to-end including subscription delivery is covered by the Playwright journey.

### Playwright journey impact

Step 7 expands from the parent spec's "DESCOPED" note to the following flow (placeholder — this spec does not edit the parent spec):

- Dashboard: wait for `cta-deposit` → click.
- URL changes to `/investor/deposit` (federation resolves the investor-mfe remote).
- Fill `deposit-amount` (e.g., `10000.00`).
- Click `deposit-confirm`.
- Assert `deposit-panel-initiated` visible (status `INITIATED`).
- Wait for `deposit-panel-detected` (Playwright auto-wait; typical 2–8s in sandbox).
- Assert success status, correct amount.
- Click `deposit-back` → URL returns to `/dashboard`.
- Dashboard step 8 then waits for the activity feed entry + KPI update (no change to step 8 beyond what the parent spec already locks).

## Acceptance criteria

- [ ] `kpi-cards.component.ts` renders a `cta-deposit` button, disabled when `initiateDeposit` flag is off.
- [ ] `/investor/deposit` route renders via investor-mfe's remote-routes table (federation verified by the parent Playwright harness).
- [ ] Form submits via the `InitiateDeposit` Apollo mutation and transitions states deterministically.
- [ ] Subscription `onDepositEvent` delivers the `DETECTED` payload to the client when the backend's event-listener fires after `DEPOSIT_DETECTED`.
- [ ] Existing `DepositIntent` row is updated with the new status (no orphan rows).
- [ ] Feature-flag-disabled state: CTA disabled; form shows banner; mutation error transitions to `failed`.
- [ ] 30s client-side timeout shows "Still processing…" banner without closing the subscription.
- [ ] Unit tests pass for the new component, the KPI card change, and the event-listener extension.
- [ ] Integration test asserts `DEPOSIT_DETECTED` → DDB status flip + IAM mutation call.
- [ ] Playwright journey step 7 exercises the full flow and is green in sandbox.

## Open questions / plan-level decisions

- **DepositIntent idempotency**: if `DEPOSIT_DETECTED` is re-delivered by the broker-sim pipeline, the `publishDepositEvent` resolver must be idempotent. Recommend `UpdateItem` with a condition that only advances INITIATED→DETECTED (never backwards). Plan refines the exact condition expression.
- **Host route resolution for `/investor/deposit`**: the host's route table currently federates `/investor/**` to investor-mfe. Plan must confirm the route table admits the `deposit` segment (vs. requiring an explicit route entry) and update `apps/nestfolio-host/src/app/app.routes.ts` only if the current wildcard doesn't cover it.
- **Currency pipe locale**: the investor profile stores a `locale` field. Plan decides whether the form respects it or hardcodes `en-US` for Phase 1. Recommend hardcoded for minimum viability.
- **Amount ceiling (10,000,000)**: chosen as a sane upper bound for test-friendliness. Plan may clamp differently based on product guidance.
- **Subscription reconnection**: Apollo's WebSocket link handles reconnects, but the 30s timeout may fire during a reconnect gap. Plan decides whether to reset the timer on reconnect events or accept the UX.
- **`FAILED` emission path**: not in Phase 1. Tracked for a follow-up when a broker rejection event is introduced.

## References

- Parent spec: [Playwright UI e2e — design](./2026-04-22-playwright-e2e-ui-design.md), §"Survey results (2026-04-22)" and journey step 7.
- Existing mutation entry: `services/investor/investor-bff/src/schema.graphql:13`.
- Existing resolver: `services/investor/investor-bff/src/graphql/js-function/initiate-deposit.fn.js`.
- Backend-complete proof (drives the mutation end-to-end, no UI): `apps/e2e-feature-tests/src/account/circuit-breaker-lifecycle.e2e.test.ts:61-68`.
- Pattern reference (IAM-signed mutation from event-listener → subscription): `services/investor/investor-bff/CLAUDE.md`, §"Handlers" — "event-listener.ts materializes … BROKER_CIRCUIT_OPEN disables 3 feature flags … via IAM-signed AppSync mutation".
- Dashboard projection target: `services/investor/dashboard-bff/src/transforms/recent-activity.ts:9` (already renders `DEPOSIT_DETECTED`).
- KPI card target: `apps/dashboard-mfe/src/app/dashboard/kpi-cards.component.ts`.
- Investor-mfe scaffolding: `apps/investor-mfe/src/app/app.routes.ts`, `apps/investor-mfe/src/app/remote-routes.ts`.
