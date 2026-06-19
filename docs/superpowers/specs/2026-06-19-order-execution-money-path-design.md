# Order-execution money path — end-to-end repair (design)

**Date:** 2026-06-19
**Status:** Design — approved, pending decomposition into implementation plans
**Backlog:** `docs/backlog/order-execution-money-path-design.md` (active, Doc-layer)
**Supersedes/repairs flows:** `flows/order-execution.flow.yaml`, `flows/order-ledger.flow.yaml`

## 1. Problem

The order→fill→ledger money path — `DECISION_APPROVED`/`USER_CONFIRMED` → execution-ctrl
`Order` → broker-ctrl `OrderStateMachine` → adapter fill → `ORDER_FILLED` → ledger-ctrl
`RecordFill` → portfolio read model — **has never functioned end-to-end in production.** It is
broken at every hop. The downstream symptom was filed as the consumer-only bug
`ledger-ctrl-live-tax-lot-missing-order-fields`; investigation (2026-06-19) showed the producer
half is total and the root cause is upstream of execution entirely.

### 1.1 Evidence (empirical, dev account 771924376645)

- `dev-broker-ctrl-orderstatemachine`: **881/881 executions FAILED**, every one at the first
  state `ReadExecutionMode` with `States.Runtime` —
  `States.Format('ExecutionMode#{}', $.tenantId)` → *"`$.tenantId` could not be found"*.
- A real failed-execution input:
  `{ type:'ORDER_SUBMITTED', subject:{ orderId, decisionPacketId, proposedTrades:[], status:'SUBMITTED' }, context:{ tenantId, userId, region } }`
  — identity is nested under `$.context`, order data under `$.subject`, and
  **`proposedTrades` is empty**.

### 1.2 The four breaks

| # | Break | Location |
|---|-------|----------|
| **Root** | Trade details (`symbol/side/amount`) never enter the execution domain — execution-ctrl's `DECISION_APPROVED`/`USER_CONFIRMED` handlers both hard-code `proposedTrades: []` ("they ride `RECOMMENDATION_PROPOSED`", which execution-ctrl never consumes) | `services/execution/execution-ctrl/src/handlers/event-listener.ts` (`fromDecisionApproved`, `fromUserConfirmed`) |
| **A** | broker-ctrl `OrderStateMachine` reads `$.tenantId/$.symbol/$.side/$.quantity` from the top of its input, but the real `ORDER_SUBMITTED` nests identity under `$.context`, data under `$.subject` → fails at `ReadExecutionMode` for 100% of orders | `services/execution/broker-ctrl/src/state-machine/order-state-machine.ts:40-128` |
| **B** | even past A, there is no trade data to route — see Root | (as Root) |
| **C** | granularity mismatch: `ORDER_SUBMITTED.subject.proposedTrades` is a 1..N array, but `BrokerOrder` is per-instrument (singular `instrumentId`/`requestedQty`) and the adapters fill ONE symbol per result | `services/execution/broker-ctrl/src/domain/contracts.ts` (`BrokerOrderSchema`) |
| **D** | `NormalizedOrderEventSchema` (the `ORDER_FILLED` contract) carries no `symbol/side/quantity`; the SF's `MarkFilledNormalizedEvent` writes only `{orderId, executionMode, filledQty, averageFillPrice, timestamp}`. ledger-ctrl `RecordFill` reads `symbol/side/quantity/fillPrice` off the stripped subject → `undefined` economics → **cash balance + positions never update on fills** | producer: `order-state-machine.ts:106-128` + `broker-ctrl/domain/contracts.ts`; consumer: `services/ledger/ledger-ctrl/src/domain/account.reducer.ts` + `handlers/event-listener.ts` |

## 2. Decisions (user-approved 2026-06-19)

1. **Trade source — enrich the authorizing events.** `DECISION_APPROVED` (compliance-ctrl) and
   `USER_CONFIRMED` (advisory-bff) carry `proposedTrades` in their subject; execution-ctrl reads
   them off the event it already consumes. Producers already hold the trades (compliance-ctrl
   receives them on `RECOMMENDATION_PROPOSED`; advisory-bff has them in its decision read model).
   No new subscriptions or cross-event join-state in execution-ctrl; preserves the existing
   L1-auto (`DECISION_APPROVED`) / L2-confirm (`USER_CONFIRMED`) operating-mode authority model.
   Establishes the reusable *"authorization event carries the payload to execute"* pattern.
2. **Granularity — one order per trade.** execution-ctrl expands `proposedTrades` into N `Order`
   rows (one per symbol), each emitting its own `ORDER_SUBMITTED` → SF → adapter → `ORDER_FILLED`
   → one ledger `RecordFill`. Fits the existing per-instrument `BrokerOrder` and per-symbol
   adapter fill with no structural rework: a clean 1 trade : 1 order : 1 fill : 1 ledger entry.
3. **Fill fields — SF composes from the bound order.** Extend `NormalizedOrderEventSchema` with
   `symbol` + `side`; the SF's `MarkFilledNormalizedEvent` writes them from its threaded input
   (`$.subject`, bound at routing) alongside the adapter's `filledQty`/`averageFillPrice`. No
   `callback-resolver` change. `symbol`/`side` are immutable request→fill (the adapter fills
   exactly what it was sent), so binding at routing is correct; the actual filled qty/price still
   come from the adapter.

## 3. Denomination (amount vs shares)

`ProposedTrade` (`services/advisory/advisory-adpt/src/domain/contracts.ts:8`,
`ProposedTradeSchema`) is `{ symbol, side: 'BUY'|'SELL', quantityOrAmountCents }` —
**dollar-amount-denominated**, not a share count. Therefore:

- The **request** side (`Order` → `ORDER_SUBMITTED` → `*_ORDER_REQUESTED`) carries
  `quantityOrAmountCents` (the requested amount). Share quantity is NOT known until fill.
- The **fill** side (adapter result → SF → `ORDER_FILLED`) carries the derived
  `filledQty` (shares) + `averageFillPrice`.
- ledger `RecordFill` therefore reads `quantity ← subject.filledQty`,
  `fillPrice ← subject.averageFillPrice`, `symbol`/`side` from the subject, `filledAt ← ctx.timestamp`.

The per-slice plan (WS-2/WS-3) MUST verify against `broker-sim-adpt`'s actual request handling
whether the `*_ORDER_REQUESTED` quantity field is amount- or share-denominated, and align
`route-order` + `BrokerOrderSchema.requestedQty` accordingly. The adapter is the place that holds
a price and can convert amount→shares.

## 4. Corrected end-to-end money path

| Hop | Service | Change |
|----|---------|--------|
| **1. Authorize** | compliance-ctrl (`ComplianceCheckSchema` → `DECISION_APPROVED`) + advisory-bff (`UserConfirmationSchema` → `USER_CONFIRMED`) | Both producer contracts add `proposedTrades: ProposedTrade[]` to the subject and the producer stamps the real trades (compliance-ctrl forwards from `RECOMMENDATION_PROPOSED`; advisory-bff's `confirmDecision` resolver reads them from the decision read model). |
| **2. Create orders** | execution-ctrl `event-listener` + `domain/contracts.ts` | Convert `OrderSchema.proposedTrades` from `z.array(z.unknown())` to typed `ProposedTrade[]`; read the trades off the authorizing event; run safety checks; **expand to N `Order` rows** (one per trade) each carrying `symbol/side/quantityOrAmountCents`; emit N `ORDER_SUBMITTED`, each subject `{orderId, symbol, side, quantityOrAmountCents, status}` (DRY — identity in context). Preserve market-open `SUBMITTED` / market-closed `STAGED` / safety-fail `REJECTED` branching per-order. |
| **3. Route** | broker-ctrl `order-state-machine.ts` + `route-order.ts` (+ `BrokerOrderSchema`) | Fix all ASL JSONPath to the standard envelope: identity from `$.context` (`tenantId`, `userId`, `region`), order data from `$.subject` (`orderId`, `symbol`, `side`, `quantityOrAmountCents`). `route-order` already reads `order.symbol/side/quantity` — they now arrive. Persist `side` on `BrokerOrder` if needed; align `requestedQty` denomination (§3). |
| **4. Fill** | broker-sim-adpt / broker-alpaca-adpt | unchanged — fills one symbol, emits `SIM/ALPACA_ORDER_FILLED` with `symbol/side/quantity/fillPrice` (sim `VirtualTradeSchema`) or `filledQuantity/averageFillPrice` (alpaca). |
| **5. Callback** | broker-ctrl `callback-resolver.ts` | **unchanged** — forwards `{status, filledQty, averageFillPrice, failureClass, failureReason}` to the SF. |
| **6. Normalize** | broker-ctrl `order-state-machine.ts` `MarkFilledNormalizedEvent` + `NormalizedOrderEventSchema` | Add `symbol`/`side` to the schema; the PutItem writes `symbol = $.subject.symbol`, `side = $.subject.side` alongside `filledQty/averageFillPrice` from `$.adapterResult`. Apply equally to `MarkPartiallyFilled` (`ORDER_PARTIALLY_FILLED`). |
| **7. Record** | ledger-ctrl `event-listener.ts` (`processOrderActualEvent`) + `account.reducer.ts` (`RecordFill`) | `parseSubject(NormalizedOrderEventSchema)` now yields `symbol/side/filledQty/averageFillPrice`; `RecordFill` reads them typed (`quantity ← filledQty`, `fillPrice ← averageFillPrice`, `filledAt ← ctx.timestamp`); remove the `as` casts and the `payload.subject` boundary cast; live tax-lots get real data. |
| **8. Project** | ledger-ctrl reducer → `AccountSnapshot` → `BALANCE/PORTFOLIO_UPDATED` | unchanged — now fed real economics; `getPortfolio` reflects fills. |

**Invariant achieved:** every hop reads typed, producer-owned fields end to end — the reusable
command→SF→normalized-event→read-model money-path pattern this workstream exists to define.

## 5. Validation strategy

- **e2e gate** (`apps/e2e-feature-tests/src/advisory/accept-decision.e2e.test.ts`, deployed dev):
  replace the synthetic ledger-bus `ORDER_FILLED` injection with a **real `ORDER_SUBMITTED` on the
  execution bus** → real broker SF → real sim fill → real `ORDER_FILLED` → real ledger →
  `getPortfolio` reflects the VTI position. Exercises every previously-broken hop (3-8) for real,
  independent of market hours.
- **execution-ctrl integration test**: `DECISION_APPROVED`/`USER_CONFIRMED` carrying
  `proposedTrades` → N `Order` rows with `symbol/side/amount` → N `ORDER_SUBMITTED` (trap-asserted).
  Covers hops 1-2 deterministically.
- **Playwright full journey** asserts the confirm→portfolio path when run in market hours — NOT the
  CI gate (the market-hours `SUBMITTED`/`STAGED` gate makes wall-clock dependence non-deterministic).
- Per `feedback-flake-means-broken` + `feedback-e2e-gaps-queued-not-parking`: any scoped e2e
  fail-then-pass pulls CloudWatch evidence from the failing window before continuing.

## 6. Scope

**In scope:** the order→fill→ledger path contracts and code across the 8 hops above; sim-path e2e
+ execution-ctrl integration coverage; flow-spec sync.

**Out of scope:**
- A real-Alpaca (live) e2e — needs real keys + the 24h `OrderPollingStateMachine`. Live
  correctness rides on the same typed contract + unit/contract tests.
- Agent/decision-cycle changes upstream of the `proposedTrades` carriage (beyond defining the
  `DECISION_APPROVED`/`USER_CONFIRMED` contract this path requires).
- Non-order money paths (deposits/withdrawals/corporate-actions).
- The `STAGED` → market-open promotion path's own e2e (the `StagedOrderProcessor` cron) — its
  contract is touched (per-order STAGED rows) but its scheduled promotion is not e2e-gated here.

## 7. Decomposition → epic `order-execution-money-path`

Minted as a `type: epic` when this design ships; the two subsumed backlog items re-home as core
members. Five sequential-by-hop slices, each an independently deployable + dev-testable Complex
worktree workstream (each can be exercised by injecting its input event):

| Slice | Domain(s) | Scope | Subsumes |
|------|-----------|-------|----------|
| **WS-1** | advisory | `DECISION_APPROVED` (compliance-ctrl) + `USER_CONFIRMED` (advisory-bff) contracts carry `proposedTrades`; producers stamp real trades | — |
| **WS-2** | execution | execution-ctrl: typed `proposedTrades`, per-trade `Order` expansion, `OrderSchema` + `ORDER_SUBMITTED` gain `symbol/side/quantityOrAmountCents` | — |
| **WS-3** | execution | broker-ctrl SF: envelope/input-contract fix (**A**) **+** `MarkFilledNormalizedEvent`/`NormalizedOrderEventSchema` enrichment (**D producer**) | `broker-ctrl-order-sf-input-contract-gap` |
| **WS-4** | ledger | ledger-ctrl: typed `RecordFill` + `event-listener`, remove casts, live tax-lots (**D consumer**) | `ledger-ctrl-live-tax-lot-missing-order-fields` (currently QUEUED rank 1) |
| **WS-5** | test/docs | real-path `accept-decision` e2e + execution-ctrl integration test + sync `flows/order-execution.flow.yaml` & `flows/order-ledger.flow.yaml` | — |

**Break → slice mapping:** Root/**B** (trades don't enter execution) → WS-1 + WS-2; **C**
(granularity) → WS-2 (per-trade expansion makes each `ORDER_SUBMITTED` single-symbol, so the SF's
existing single-instrument model fits unchanged); **A** (SF envelope) → WS-3; **D** → WS-3
(producer) + WS-4 (consumer).

**Ordering:** WS-1 → WS-2 → WS-3 → WS-4 → WS-5 by data dependency, but each slice is testable in
isolation by injecting its input event, so they may be built in any order; WS-5's end-to-end gate
requires all of WS-1..WS-4 deployed.

## 8. Risks / implementation details to pin in per-slice plans

- **Amount-vs-shares denomination** (§3) — verify `broker-sim-adpt` request handling before
  finalizing `route-order` + `BrokerOrderSchema.requestedQty`.
- **USER_CONFIRMED producer module** — `confirmDecision` is an intent-only JS resolver in
  advisory-bff; stamping `proposedTrades` onto the `UserConfirmation` row requires reading them
  from the decision read model in that resolver. Pin the exact resolver + `UserConfirmationSchema`
  owner (advisory-adpt re-exports it) in the WS-1 plan.
- **Double-trigger guard** — confirm `DECISION_APPROVED` and `USER_CONFIRMED` do not both create
  orders for the same decision (operating-mode authority should make them mutually exclusive);
  per-trade expansion must remain idempotent on `orderId`.
- **`ORDER_PARTIALLY_FILLED`** carries the same enrichment (WaitForMoreFills re-threads `$`).
- **Read-model ownership** — `NormalizedEvent` enrichment and any new `Order`/`BrokerOrder` fields
  must respect the frozen single-writer ownership model + the `read-model-drift` gate.
- **typed-test-fixtures** — `ORDER_*` fixtures are registered against `NormalizedOrderEventSchema`;
  adding `symbol/side` updates the producer contract, so the typed fixtures + `check-typed-fixtures`
  gate update with WS-3.
