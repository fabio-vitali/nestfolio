# Deposit / Withdrawal live-push transport — design

**Status:** approved (brainstorm), pending spec-review gate
**Date:** 2026-06-01
**Lands on:** `worktree-feat+bff-readmodel-w5-externally-settled-entities` (folded into w5 — completes Phase 6's done-definition; NOT a separate workstream)
**Parent:** `bff-readmodel-w5-externally-settled-entities` / `docs/superpowers/plans/2026-05-31-w5-externally-settled-entities.md`
**Reference pattern:** dashboard-bff live-push (`services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts`, `graphql/js-function/publish-activity-update.fn.js`, `service.stack.ts:49-69`)

## Problem (regression w5 caused)

w5 Task 4.6 deleted the `onDepositEvent` subscription + `publishDepositEvent` mutation (the old dual-writer live-push). The `Deposit`/`WithdrawalRequest` rows became P1 projections written by `projectVersioned` (direct DDB writes from broker-ctrl lifecycle events). But the investor-mfe deposit-pending-page still subscribes to `onDepositEvent` (now nonexistent), so the backend Deposit row updates to DETECTED/SETTLED (integration 19/19 proves this; `getDeposit` returns the row) **but nothing pushes the update to the open browser** → Playwright `deposit-reload-mid-flight` + `new-investor-happy-path` time out at 120s waiting for `deposit-panel-detected`. The page reaches INITIATED and survives F5 (optimistic UI works); only the live DETECTED→browser transport is severed.

This is transport-only (frontend + BFF schema). The w5 plan had zero `investor-mfe` tasks — net-new scope, folded into w5 because w5 caused the regression and must not merge red.

## Decisions (settled with user 2026-06-01)
- **D1 — Fold into w5**, not a separate workstream. w5 ships green end-to-end in one PR.
- **D2 — Filter key = `depositId` / `withdrawalId`** (per-transfer), matching the deleted `onDepositEvent(depositId)` contract + the MFE's existing `subscribeToDepositEvent(depositId)` call shape. Minimal client change, tightest fan-out.
- **D3 — Symmetric: Deposit + WithdrawalRequest.** Both are P1 projections w5 created; both get live-push now (the withdrawal transport gap is latent — no MFE page watches it yet — but closing it keeps the funding read-model symmetric).

## Architecture

Mirror dashboard-bff's `broadcastFromStream` pattern exactly. The P1 projection write (Phase-4 `projectVersioned`) is unchanged; the broadcast is a **post-commit side effect off the DynamoDB stream** — no race with the engine's write.

```
broker-ctrl lifecycle event → investor-bff Ingress → depositLifecycle/withdrawalLifecycle
  → projectVersioned writes Deposit#<id> / Withdrawal#<id> P1 row   (UNCHANGED, Phase 4)
        │ DDB stream (NEW second consumer)
        ▼
  deposit-publisher.ts (broadcastFromStream)
        │ IAM-signed AppSync mutation
        ▼
  publishDepositUpdate / publishWithdrawalUpdate  (none-datasource resolver)
        │ @aws_subscribe fan-out
        ▼
  onDepositUpdate(depositId) / onWithdrawalUpdate(withdrawalId) → investor-mfe
```

## Components

### 1. BFF schema — `services/investor/investor-bff/src/schema.graphql`
Re-add a funding live-push (better contract than the deleted `onDepositEvent`: carries the new `SETTLED` status + `detectedAt`/`settledAt`). The `@aws_subscribe` filter pivot (`depositId`/`withdrawalId`) MUST be present in the mutation RESPONSE type + resolver + the publisher's mutation selection, or the broadcast silently drops (see `feedback_appsync_subscribe_filter_args`).

```graphql
type DepositUpdate @aws_cognito_user_pools @aws_iam {
  depositId: ID!            # filter pivot — MUST be in response
  status: String!           # INITIATED | DETECTED | SETTLED | FAILED
  amountCents: Int!
  currency: String!
  detectedAt: String
  settledAt: String
  failedAt: String
  reason: String
}
type WithdrawalUpdate @aws_cognito_user_pools @aws_iam {
  withdrawalId: ID!         # filter pivot
  status: String!           # REQUESTED | SETTLED | FAILED
  amountCents: Int!
  currency: String!
  settledAt: String
  failedAt: String
  reason: String
}
# Mutation — IAM-only, none-datasource, fired by the publisher Lambda:
  publishDepositUpdate(depositId: ID!, status: String!, amountCents: Int!, currency: String!, detectedAt: String, settledAt: String, failedAt: String, reason: String): DepositUpdate @aws_iam
  publishWithdrawalUpdate(withdrawalId: ID!, status: String!, amountCents: Int!, currency: String!, settledAt: String, failedAt: String, reason: String): WithdrawalUpdate @aws_iam
# Subscription:
  onDepositUpdate(depositId: ID!): DepositUpdate @aws_subscribe(mutations: ["publishDepositUpdate"])
  onWithdrawalUpdate(withdrawalId: ID!): WithdrawalUpdate @aws_subscribe(mutations: ["publishWithdrawalUpdate"])
```
Resolvers: `src/graphql/js-function/publish-deposit-update.fn.js` + `publish-withdrawal-update.fn.js` — `none`-datasource, `request → {payload:{}}`, `response → ctx.arguments` (mirror `publish-activity-update.fn.js`). Register both in `discoverJsResolvers({ noneDataSource: [...] })`.

### 2. Publisher Lambda — `services/investor/investor-bff/src/handlers/deposit-publisher.ts`
`broadcastFromStream({ serviceName:'investor-bff', appsyncUrl, broadcasts: { Deposit: {...}, WithdrawalRequest: {...} } })`. Each `mapImage(item)` reads the projected row fields → the publish-mutation variables (status, amountCents, currency, the timestamps, the id). Deposit broadcasts on every status (INITIATED via the intent? no — the projected Deposit row is written by lifecycle events starting at REQUESTED/DETECTED; the optimistic INITIATED is client-only). `whenChanged: ['status']` so only status transitions broadcast (avoids a redundant fire if a same-status row rewrite ever happens); confirm against broadcastFromStream's change-gate semantics.

CDK (`service.stack.ts`): add a `NodejsFunction` `DepositPublisher` with `DynamoEventSource(state.getTable(), { startingPosition: LATEST, retryAttempts: 3 })`, `environment: { APPSYNC_URL: facade.graphqlUrl }`, and `appsync:GraphQL` grant on `facade.api.arn/*`. Copy dashboard-bff's block. Add the two resolvers to the existing `discoverJsResolvers` config.

### 3. investor-mfe
- `src/app/graphql/investor-bff.subscriptions.ts`: replace `ON_DEPOSIT_EVENT`/`onDepositEvent` with `ON_DEPOSIT_UPDATE`/`onDepositUpdate(depositId)` selecting the `DepositUpdate` fields; add `ON_WITHDRAWAL_UPDATE` for symmetry.
- `src/app/services/deposit.service.ts`: `subscribeToDepositEvent(depositId, onEvent)` points at `ON_DEPOSIT_UPDATE`; map `data.onDepositUpdate` → the page's event shape (status + occurredAt-equivalent from detectedAt/settledAt). The `DepositEvent` interface's `status` union widens to include `SETTLED`.
- `src/app/deposit/deposit-pending-page.component.ts`: already branches on `status === 'DETECTED'`; add a `SETTLED` branch to the same terminal panel (DETECTED and SETTLED both mean "funds arrived" for the pending UX — keep `deposit-panel-detected` testid satisfied on either, OR add `deposit-panel-settled`; decide in plan, but the Playwright POM waits for `deposit-panel-detected`, so DETECTED must still render that panel).

## Out of scope
- A withdrawal pending-page in the MFE (none exists; only the subscription plumbing is added for symmetry).
- The `wss-subscription-test-harness-test-support` gap (asserting real WSS delivery in integration) — out of scope; integration asserts the publish-mutation invocation like `dashboard-publisher.test.ts`. File-and-keep if it bites.
- dashboard-bff's own deposit activity (already handled by w5 Phase 5 rename).

## Testing
- **investor-bff unit:** `deposit-publisher.test.ts` (mapImage → mutation vars for Deposit + WithdrawalRequest, change-gate on status); publish-resolver response-shape unit (pivot id in response).
- **investor-bff integration:** assert the publisher fires `publishDepositUpdate` on a Deposit P1 row write (mirror `dashboard-publisher.test.ts` / dashboard-bff integration; assert the IAM mutation invocation, not WSS delivery).
- **investor-mfe unit:** `deposit.service` subscription wiring points at `onDepositUpdate`.
- **The real gate:** redeploy investor-bff + investor-web (MFE), re-run the 2 Playwright deposit specs (`deposit-reload-mid-flight` + `new-investor-happy-path`) → must pass twice consecutively (anti-flake discipline, `apps/nestfolio-e2e/CLAUDE.md`).

## Risks
- **R-A — @aws_subscribe filter pivot omission.** The #1 silent-failure mode here (see `feedback_appsync_subscribe_filter_args`): `depositId` must be in the response type AND the resolver return AND the publisher's mutation selection. Covered by the publish-resolver unit + the Playwright gate.
- **R-B — MFE federation rebuild.** investor-mfe is a Native Federation remote; the Playwright `e2e` target rebuilds all MFEs. Confirm the deposit page change is picked up (no stale remote).
- **R-C — INITIATED vs first projected status.** The optimistic INITIATED is client-only (resolver synthetic return); the first PROJECTED row status is `requested`→`REQUESTED` (deposit) or `detected`→`DETECTED`. The page must not regress the optimistic INITIATED when an early REQUESTED projection broadcast arrives — keep the page's status precedence monotonic (INITIATED ≤ REQUESTED ≤ DETECTED ≤ SETTLED). Decide precedence handling in the plan.
