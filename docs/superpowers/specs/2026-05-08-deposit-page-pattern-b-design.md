# Deposit page Pattern B refactor — design

**Workstream id:** `deposit-page-pattern-a-to-pattern-b`
**Status:** design (ready for plan)
**Date:** 2026-05-08

## Why

`apps/investor-mfe/src/app/deposit/deposit-page.component.ts:180` opens the AppSync subscription `onDepositEvent(depositId, …)` *after* `initiateDeposit()` returns and stores `depositId` in component-local state. Two consequences:

1. **Reload mid-flight loses the subscription.** A page reload while in the `INITIATED` waiting state drops the depositId (it lives only in a signal), so the component re-renders the empty form. The backend continues processing, but the UI never sees DETECTED.
2. **Hot-broker DETECTED frame can arrive before subscribe is ready.** AppSync's WebSocket `start_ack` adds ~200 ms after `subscribe()` is called. When `broker-sim` is warm (cached Lambda) it can publish DETECTED inside that window. The frame is fanned out to a subscriber that doesn't exist yet — there is no replay buffer. The UI sits on `INITIATED` until the 30 s timeout fires.

Three other MFE views (`dashboard-container`, `notification-list`, `decision-detail`) already use Pattern B (subscribe-before-query, depositId-equivalent in the URL). `deposit-page` is the lone Pattern A holdout.

The backlog item (`docs/backlog/deposit-page-pattern-a-to-pattern-b.md`) calls out both consequences and references `apps/advisory-mfe/src/app/decision/decision-detail.component.ts:377` as the Pattern B exemplar.

## What changes (scope)

Both bugs are fixed in one go:

- The page splits into two single-purpose components on two routes: `/deposit` (form) and `/deposit/:depositId` (pending/result).
- The browser generates the `depositId` (`crypto.randomUUID()`) before navigating; the form passes amount + currency via Angular router `state`.
- The pending component on init: subscribe → await subscription `start_ack` → call `getDeposit(depositId)`; on `NotFoundError` fall back to `initiateDeposit({depositId, …})` from `history.state`.
- A new `getDeposit(depositId): Deposit` query is added to investor-bff.
- `DepositInput` gains a required `depositId: ID!` field; `initiate-deposit.fn.js` reads the id from input instead of `util.autoId()`.
- `DepositService.subscribeToDepositEvent` returns (or pairs with) a `ready: Promise<void>` that resolves on AppSync `start_ack`.

## Out of scope

- **No `DepositEvent` versioning.** `decision-detail` uses a numeric version guard for out-of-order frames; deposits don't need it (DETECTED/FAILED are terminal, INITIATED is the starting state, the publisher only fires on non-INITIATED transitions).
- **No buffer / replay on the AppSync side.** Subscribe-readiness + `getDeposit` recovery covers the gap.
- **No tenant-isolation rework.** Server-side `getDeposit` resolver scopes the lookup with caller's `tenantId`+`userId` (same pattern as existing resolvers); cross-tenant URL paste returns `NotFoundError`.
- **No new feature flag for the rollout.** The two bugs are user-visible defects; no need to gate the fix.
- **No backwards-compatibility for the old `DepositInput` shape.** Per `feedback_no_deprecation` — dev deployment is disposable, breaking the input shape is acceptable.
- **No Angular auto-redirect from `/deposit/:depositId` to `/deposit` when the URL is invalid.** We render a dedicated invalid-URL panel with a CTA button instead, so the user understands what happened.
- **No retry on subscription drop.** The existing `console.error` behaviour (`deposit.service.ts:54`) is preserved; the 30 s timeout still fires.

## Architecture

```
┌─────────────────┐                  ┌──────────────────────────┐
│ /deposit        │  click Confirm   │ /deposit/:depositId      │
│ DepositForm     │ ───────────────▶ │ DepositPendingPage       │
│  (form-only)    │  router.state:   │  (pending/result)        │
│                 │  {amountCents,   │                          │
│                 │   currency}      │ ngOnInit:                │
└─────────────────┘                  │  subscribe → ready       │
                                     │  → getDeposit            │
                                     │   (NotFound → mutate     │
                                     │    from history.state)   │
                                     │  → hydrate, armTimeout   │
                                     └──────────────────────────┘
```

- Two route entries, both registered in `apps/investor-mfe/src/app/remote-routes.ts` (and the local `app.routes.ts` mirror).
- The existing `DepositService` provider scope (`remoteRoutes` parent) covers both child routes.
- `getDeposit` is wired alongside the existing JS resolvers in `services/investor/investor-bff/src/graphql/js-function/`.

## Components

### `DepositFormComponent`

Path: `apps/investor-mfe/src/app/deposit/deposit-form.component.ts`. ~80 LoC, standalone.

Reuses today's form template (PrimeNG `inputNumber` + Confirm/Cancel + feature-flag warning). Owns: `amount` signal, `flagEnabled`/`flagReason` computed, `confirmDisabled` computed, `cancel()`. Does **not** own subscription, deposit lifecycle state, or timeout.

```ts
async submit(): Promise<void> {
  if (this.confirmDisabled()) return;
  const depositId = crypto.randomUUID();
  this.router.navigate(['/deposit', depositId], {
    state: { amountCents: Math.round((this.amount() ?? 0) * 100), currency: 'USD' },
  });
}
```

### `DepositPendingPageComponent`

Path: `apps/investor-mfe/src/app/deposit/deposit-pending-page.component.ts`. ~140 LoC, standalone.

Reuses the four result panels (`initiated` / `timeout` / `detected` / `failed`) from today's component plus a new `invalidUrl` panel. Owns: `state`, `depositIntent`, `depositEvent`, `failureReason` signals; timeout handle; subscription lifecycle.

```ts
async ngOnInit(): Promise<void> {
  const depositId = this.route.snapshot.paramMap.get('depositId')!;
  this.deposit.subscribeToDepositEvent(depositId, e => this.onEvent(e));
  try {
    await this.deposit.waitForSubscriptionReady();
  } catch {
    this.failureReason.set('Couldn\'t connect to server');
    this.state.set('failed');
    return;
  }
  let intent: DepositIntent;
  try {
    intent = await this.deposit.getDeposit(depositId);
  } catch (err) {
    if (!isNotFoundError(err)) { this.handleFatal(err); return; }
    const navState = history.state as { amountCents?: number; currency?: string };
    if (!navState?.amountCents) { this.state.set('invalidUrl'); return; }
    try {
      intent = await this.deposit.initiateDeposit({
        depositId, amountCents: navState.amountCents, currency: navState.currency ?? 'USD',
      });
    } catch (mutErr) { this.handleFatal(mutErr); return; }
  }
  this.hydrateFromIntent(intent);
  if (this.state() === 'initiated') this.armTimeout();
}
```

### `DepositService` (modified — `apps/investor-mfe/src/app/services/deposit.service.ts`)

- `initiateDeposit(input)` — `DepositInput` requires `depositId`.
- `subscribeToDepositEvent(depositId, onEvent)` — unchanged signature; internally now also tracks an `_ready` deferred that resolves on the first AppSync `start_ack` payload.
- `waitForSubscriptionReady(): Promise<void>` — **new**. Resolves on the latest active subscription's `start_ack`; rejects if subscription closes before ready.
- `getDeposit(depositId): Promise<DepositIntent>` — **new**. Wraps the AppSync `getDeposit` query, throws `DepositNotFoundError` on null result.

### Files removed
- `deposit-page.component.ts` deleted.
- Route entry in `remote-routes.ts` (and `app.routes.ts`) for path `'deposit'` is replaced with two entries.

## Data flow + subscribe-readiness

The crux of the race fix is that the WS subscription must be `ACTIVE` on AppSync's side before the mutation hits the resolver.

```
T+0     pending mount, depositId from URL
T+5     subscribeToDepositEvent(depositId)              [WS subscribe sent]
T+205   AppSync responds start_ack                      [ready resolves]
T+206   getDeposit(depositId)                           [defensive recovery query]
T+255   getDeposit returns NotFoundError (fresh submit)
T+256   initiateDeposit({depositId, amount, currency})
T+300   row written, mutation returns DepositIntent
T+305   hydrate: state='initiated', armTimeout()

(later)
T+1500  broker-sim publishes DEPOSIT_DETECTED via the broadcast chain
T+1900  publishDepositEvent fan-out → onDepositEvent frame delivered
T+1905  state='detected', clearTimeout
```

### Reload-after-completion path

```
T+0     pending mount, depositId from URL, history.state empty
T+5     subscribeToDepositEvent(depositId)
T+205   ready
T+210   getDeposit(depositId) → returns row with status='DETECTED'
T+215   hydrate: state='detected'                        [no timeout armed]
```

### `getDeposit` resolver

`services/investor/investor-bff/src/graphql/js-function/get-deposit.fn.js`:

```js
import { util } from '@aws-appsync/utils';
import * as ddb from '@aws-appsync/utils/dynamodb';

export function request(ctx) {
  const { tenantId, userId } = ctx.stash;
  const { depositId } = ctx.arguments;
  if (!depositId) util.error('depositId required', 'ValidationError');
  return ddb.get({
    key: { pk: `InvestorProfile#${tenantId}#${userId}`, sk: `Deposit#${depositId}` },
  });
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (!ctx.result) util.error('Deposit not found', 'NotFoundError');
  return ctx.result;
}
```

The DDB row has all the fields needed (`initiate-deposit.fn.js:14-19`).

### Schema deltas

`services/investor/investor-bff/src/schema.graphql`:

```graphql
input DepositInput {
  depositId: ID!         # NEW — required
  amountCents: Int!
  currency: String!
}

type Query {
  ...
  getDeposit(depositId: ID!): Deposit!     # NEW
}

type Deposit @aws_cognito_user_pools {
  depositId: ID!
  amountCents: Int!
  currency: String!
  status: String!
  initiatedAt: String!
  detectedAt: String        # nullable, populated by DEPOSIT_DETECTED transform
  failedAt: String          # nullable
  reason: String            # nullable, populated on FAILED
}
```

The `Deposit` type replaces `DepositIntent` everywhere — `initiateDeposit` returns `Deposit!`, `getDeposit` returns `Deposit!`. One type, one shape. The frontend's `DepositIntent` interface in `deposit.service.ts` is renamed `Deposit` to match (with the new optional `detectedAt`/`failedAt`/`reason` fields).

### `initiate-deposit.fn.js` change

```js
const depositId = input.depositId;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!depositId) util.error('depositId required', 'ValidationError');
if (!UUID_V4_RE.test(depositId)) util.error('depositId must be UUID v4', 'ValidationError');
```

(No more `util.autoId()`. The client supplies `crypto.randomUUID()` which is RFC 4122 v4.)

Frontend recognises `NotFoundError` from AppSync's `errorType` field (set by `util.error('Deposit not found', 'NotFoundError')` in the resolver). `DepositService.getDeposit` re-throws as a typed `DepositNotFoundError` instance for clean `instanceof` checks in the pending component.

## Frame-merge logic

Both the subscription and `getDeposit` can deliver state. Rules (last-writer-wins on `state` signal):

| Source | Action |
|---|---|
| `getDeposit` returns `INITIATED` | `state='initiated'`, hydrate amount/currency from row |
| `getDeposit` returns `DETECTED` | `state='detected'`, no timeout |
| `getDeposit` returns `FAILED` | `state='failed'`, render `reason` |
| Subscription frame `INITIATED` | Ignore (already hydrated) |
| Subscription frame `DETECTED` | `state='detected'`, clearTimeout |
| Subscription frame `FAILED` | `state='failed'`, clearTimeout, set reason |

No version guard needed (DETECTED/FAILED are terminal; the publisher only fires once per non-INITIATED transition).

## Error handling

| Failure | UI |
|---|---|
| `initiateDeposit` rejects (e.g. circuit breaker flipped between form-click and pending mount) | `state='failed'`, surface error; "Try again" → `/deposit` |
| `getDeposit` `NotFoundError` AND `history.state` empty | `invalidUrl` panel with CTA → `/deposit` |
| `getDeposit` succeeds with `status='FAILED'` | `state='failed'`, render `reason` from row |
| `waitForSubscriptionReady` rejects (WS connection failure) | `state='failed'`, "Couldn't connect to server" + retry button (re-runs `ngOnInit`) |
| Subscription drops mid-wait | `console.error`, state unchanged; 30 s timeout still fires (matches today's behaviour) |
| 30 s timeout in `INITIATED` | Existing `timeout` panel, copy unchanged |
| Subscription delivers `DETECTED` | `state='detected'`, terminal |

### Edge cases (no special code)

- **Browser back during waiting** → `ngOnDestroy` unsubscribes; backend keeps processing; orphan DETECTED frame is published to no-one — equivalent to today.
- **Two tabs on same `/deposit/:id`** → both subscribe and query, no conflict (server state is idempotent).
- **Feature-flag flip** between form click and pending mount → mutation rejects with `FeatureFlagDisabled` → handled by row 1 above.
- **Cross-tenant URL paste** → resolver lookup uses caller's `tenantId`+`userId` → `NotFoundError` → `invalidUrl` panel.

## Testing

### Unit (Angular TestBed for components, plain Jest for resolvers)

`DepositFormComponent` (`apps/investor-mfe/src/app/deposit/deposit-form.component.spec.ts`):
- `confirmDisabled` true when amount null / ≤0 / flag disabled.
- `submit()` calls `crypto.randomUUID`, navigates to `/deposit/:id` with `{amountCents, currency: 'USD'}` in router state.
- `cancel()` navigates to `/dashboard`.

`DepositPendingPageComponent` (sibling spec):
- **`subscribe is called before initiateDeposit`** — spy on `DepositService.subscribeToDepositEvent` + `initiateDeposit`, assert `mock.invocationCallOrder`. **Regression test for the race fix.**
- `getDeposit` returning `INITIATED`/`DETECTED`/`FAILED` hydrates state correctly (3 cases).
- `getDeposit` `NotFoundError` + empty `history.state` → `invalidUrl` panel.
- `getDeposit` `NotFoundError` + populated `history.state` → `initiateDeposit` fires with depositId from URL.
- Subscription frame `DETECTED` after `INITIATED` hydration → `state='detected'` + timeout cleared.
- 30 s timeout from `INITIATED` → `state='timeout'`.
- `ngOnDestroy` unsubscribes + clears timeout.

`DepositService` — `getDeposit` shape, `initiateDeposit` passes `depositId` through, `waitForSubscriptionReady` resolves on first ready signal.

Resolver units (`services/investor/investor-bff/test/unit/graphql/`):
- `get-deposit.fn.test.ts` (new) — happy path, `NotFoundError`, request shape uses caller's `tenantId`+`userId`.
- `initiate-deposit.fn.test.ts` (modified) — input requires `depositId`, validates UUID format, persists with provided id.

### Integration (`investor-bff.integration.test.ts`, extend existing)

Three new cases in the existing AppSync block:
- `initiateDeposit` with client-supplied `depositId` writes that exact id to DDB → CDC emits `DEPOSIT_INITIATED` carrying it (verify via `eventBusTrap`).
- `getDeposit(depositId)` returns the row written above.
- `getDeposit(depositId)` for a depositId that doesn't exist → `NotFoundError`.

Tenant-isolation is verified by the resolver unit test asserting `pk` includes the caller's `tenantId`+`userId`. A cross-tenant integration test would require multi-tenant fixtures the existing `investor-bff.integration.test.ts` doesn't have, and the resolver-level guarantee is structurally sufficient.

### E2E

The existing happy-path Playwright at `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts:122-133` covers form → `INITIATED` → `DETECTED`. The refactor must not regress it; URL assertion at line 127 (`/\/investor\/deposit$/`) checks the form route, which remains valid (form still mounts at `/investor/deposit` after `clickDeposit`). The submit-then-wait POM steps are element-based (`[data-testid=deposit-panel-initiated]`, `[data-testid=deposit-panel-detected]`), unaffected by the new `:depositId` URL segment.

One new Playwright scenario in `apps/nestfolio-e2e/src/journeys/`:
- **Reload mid-flight.** Submit deposit, capture the post-submit URL, before `[data-testid=deposit-panel-detected]` appears reload the page (`page.reload()`), assert the pending panel re-renders with the same amount and the DETECTED panel arrives within 10 s.

The hot-broker race fix is regression-tested by the `subscribe before mutate` ordering assertion in the unit suite — a brittle e2e timing test isn't worth the maintenance cost.

### Acceptance gate (validation_gate when shipping)

- All units green (existing + new).
- `pnpm nx run investor-bff:test-integration` green against deployed dev.
- `pnpm nx run nestfolio-e2e:e2e` green for the existing happy-path scenario (`new-investor-happy-path.spec.ts`, deposit covered at lines 122-133) plus the new reload-mid-flight scenario.
- Manual verification on dev: form → pending → DETECTED happy path; F5 mid-flight → DETECTED arrives.

## Implementation order (sketch — for the plan)

1. Backend: schema + `get-deposit.fn.js` + `initiate-deposit.fn.js` change. Resolver units.
2. Backend integration tests for `initiateDeposit(depositId)` + `getDeposit`.
3. `DepositService` updates — `getDeposit`, `waitForSubscriptionReady`, `initiateDeposit` input shape.
4. Component split — `DepositFormComponent` + `DepositPendingPageComponent`. Component units.
5. Route registration in `remote-routes.ts` + `app.routes.ts`. Delete `deposit-page.component.ts`.
6. E2E reload-mid-flight scenario.
7. Deploy to dev, manual smoke, run e2e suite.

The plan skill will sequence these concretely with TDD discipline (tests-before-impl in each step).

## References

- Backlog: `docs/backlog/deposit-page-pattern-a-to-pattern-b.md`
- Pattern A (today's bug): `apps/investor-mfe/src/app/deposit/deposit-page.component.ts:180`
- Pattern B exemplar: `apps/advisory-mfe/src/app/decision/decision-detail.component.ts:377`
- Existing resolvers: `services/investor/investor-bff/src/graphql/js-function/initiate-deposit.fn.js`, `publish-deposit-event.fn.js`
- Service card: `services/investor/investor-bff/CLAUDE.md`
