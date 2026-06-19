---
id: ledger-ctrl-live-tax-lot-missing-order-fields
status: queued
epic: typed-subject-consumer-contract-gaps
epic_role: core
rank: 1
type: bug
notes: "Pre-existing latent bug surfaced 2026-06-12 by consumer-parse-subject (WS-3) while typing the ledger-ctrl ORDER_FILLED read. ledger-ctrl/handlers/event-listener.ts live-fill tax-lot path reads subject.symbol / subject.side / subject.quantity / subject.fillPrice off the ORDER_FILLED subject, but the PRODUCER (broker-ctrl order state machine, order-state-machine.ts:106-128 MarkFilledNormalizedEvent) writes ONLY {orderId, executionMode, filledQty, averageFillPrice, timestamp, tenantId/userId/region}. NormalizedOrderEventSchema (broker-ctrl/domain/contracts.ts) codifies exactly that minimal shape; symbol/side are DROPPED at broker-ctrl/callback-resolver.ts (it forwards only filledQty + averageFillPrice from the adapter result into the SF). So for LIVE fills, taxLotManager.openLot/closeLot have been called with symbol=undefined, quantity from a non-existent filledQuantity/quantity field, costBasisPerShare from a non-existent fillPrice — i.e. the live-fill tax-lot tracking never functioned. symbol/side DO survive on the adapter result rows (broker-sim-adpt VirtualTradeSchema has symbol/side/quantity/fillPrice; broker-alpaca-adpt AlpacaOrderResultSchema has symbol/side/requestedQty) and on the BrokerOrder state row (instrumentId/requestedQty), but neither flows into the emitted ORDER_FILLED subject. Fix options: (a) extend broker-ctrl's MarkFilled/MarkPartiallyFilled NormalizedEvent PutItem + NormalizedOrderEventSchema to carry symbol/side/quantity (producer change + deploy + e2e on a real live fill), or (b) have ledger-ctrl source symbol/side from a BrokerOrder GetItem (keyed on orderId) or from the originating decision packet via decisionId. WS-3 did NOT fix this (consumer-typing only) — it types the contract-backed ORDER_FILLED fields (orderId/executionMode/filledQty/averageFillPrice) and confines the symbol/side/quantity reads to ONE documented boundary cast referencing this item, preserving the (broken) prior behavior. PROMOTED to QUEUED 2026-06-19 (rank 1): handed off from the re-scoped consolidated verify ([[typed-test-fixtures-consolidated-integration-e2e-verify]] closed on the fixtures-criterion) as a real live-money bug — RecordFill receives undefined economics so cash balance + positions are NOT updated on fills, and the accept-decision e2e (getPortfolio-reflects-fill) is RED end-to-end by design. Note overlap with broker-ctrl-order-sf-input-contract-gap (the order-execution SF input contract) — both stem from the order path's minimal NormalizedEvent shape. EXTENDED 2026-06-19 (by typed-test-fixtures-cross-domain-order-events): the SAME missing-fields gap also breaks the CORE balance/position reducer, not just tax-lots — account.reducer.ts RecordFill reads p['symbol']/p['side']/p['quantity']/p['fillPrice'] from the LedgerEntry payload, but that payload is {...parseSubject(NormalizedOrderEventSchema)} (those keys stripped) → undefined → cash balance + positions are NOT updated on order fills in production. CloudWatch on dev confirmed the handler now processes ORDER_FILLED ZodError-free once the fixture is typed, but RecordFill receives undefined economics. The accept-decision e2e 'getPortfolio reflects the fill' assertion exercises this end-to-end (retained as proof). Scope of the fix is unchanged (broker-ctrl must EMIT symbol/side/quantity/fillPrice on ORDER_FILLED, or ledger-ctrl must source them from BrokerOrder/decisionId) — but the blast radius is wider than originally filed (core ledger money math, not only tax-lot tracking)."
references:
  - services/ledger/ledger-ctrl/src/domain/account.reducer.ts
  - apps/e2e-feature-tests/src/advisory/accept-decision.e2e.test.ts
  - docs/backlog/typed-test-fixtures-cross-domain-order-events.md
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# ledger-ctrl live-fill tax-lot reads order fields ORDER_FILLED doesn't carry

Pre-existing latent bug surfaced by the WS-3 typed-subject consumer conversion.

## Symptom

ledger-ctrl's live-fill tax-lot path (`services/ledger/ledger-ctrl/src/handlers/event-listener.ts`,
`processOrderActualEvent`) reads `symbol`, `side`, `quantity`/`filledQuantity`, `fillPrice` off the
`ORDER_FILLED` subject to call `taxLotManager.openLot`/`closeLot`. None of those fields are on the
event. They resolve to `undefined` in production → live-fill tax lots are recorded with no symbol and
no usable quantity/cost basis.

## Root cause

`ORDER_FILLED` is CDC-emitted from broker-ctrl's `NormalizedEvent` row, written by the order state
machine (`services/execution/broker-ctrl/src/state-machine/order-state-machine.ts:106-128`,
`MarkFilledNormalizedEvent`). That PutItem writes only `orderId`, `executionMode`, `filledQty`,
`averageFillPrice`, `timestamp` (+ identity). `symbol`/`side` are dropped at
`broker-ctrl/src/handlers/callback-resolver.ts` (forwards only `filledQty` + `averageFillPrice` from
the adapter result to the SF). `NormalizedOrderEventSchema` (broker-ctrl/domain/contracts.ts) codifies
this minimal shape. The data exists upstream (broker-sim-adpt `VirtualTradeSchema`, broker-alpaca-adpt
`AlpacaOrderResultSchema`, and the `BrokerOrder` state row) but never reaches the emitted subject.

## Fix options

1. **Producer-side:** add `symbol`/`side`/`quantity` to the `MarkFilled`/`MarkPartiallyFilled`
   NormalizedEvent PutItem params + `NormalizedOrderEventSchema`. Requires the upstream SF input to
   carry them (reconcile with `broker-ctrl-order-sf-input-contract-gap`). Deploy broker-ctrl + e2e a
   real live fill.
2. **Consumer-side:** ledger-ctrl sources `symbol`/`side` via a `BrokerOrder` GetItem (keyed on
   `orderId`) or from the originating decision packet (`decisionId`).

## WS-3 disposition

Out of WS-3 scope (consumer-typing only, no producer change). WS-3 types the contract-backed fields and
confines the symbol/side/quantity reads to a single documented boundary cast referencing this item,
preserving the broken-but-unchanged behavior. Overlaps `broker-ctrl-order-sf-input-contract-gap`.

## 2026-06-19 escalation — also breaks the core balance/position reducer

Surfaced by `typed-test-fixtures-cross-domain-order-events` while typing the ORDER_* fixtures and
re-running the ledger-ctrl integration suite against deployed dev. The bug is **not confined to the
live tax-lot path** — it also hits the core ledger reducer:

`services/ledger/ledger-ctrl/src/domain/account.reducer.ts` (case `ORDER_FILLED`/`ORDER_PARTIALLY_FILLED`)
calls `applyCommand(RecordFill, { symbol: p['symbol'], side: p['side'], quantity: p['quantity'],
fillPrice: p['fillPrice'], filledAt: p['filledAt'] })`. The reducer's `p` is the LedgerEntry payload,
built in `processOrderActualEvent` as `eventPayload = { ...subject }` where
`subject = parseSubject(payload, NormalizedOrderEventSchema)`. `parseSubject` **strips** any key not in
the schema, so `symbol/side/quantity/fillPrice/filledAt` are gone → `RecordFill` runs with `undefined`
economics. **Cash balance and positions are therefore not correctly updated on order fills in
production** (both `simulation` and `live` — this path is not gated on `executionMode`, unlike the
tax-lot block).

### Evidence
- CloudWatch (dev `dev-ledger-ctrl-IngressHandler…`) 2026-06-19: ORDER_FILLED with `executionMode:'paper'`
  + no `timestamp` produced `ZodError` (the co-wrong untyped fixture). After typing the fixture to a valid
  `NormalizedOrderEvent`, the handler processes ORDER_FILLED with no error — but the reducer economics are
  `undefined` by construction (fields not in the schema).
- The `accept-decision` e2e (`apps/e2e-feature-tests/src/advisory/accept-decision.e2e.test.ts`) asserts
  `getPortfolio` reflects the injected fill (cashBalanceCents + positions). With the fixture typed to the
  real producer contract, that assertion exercises this broken path end-to-end and is retained as the
  e2e proof of impact.

### Disposition
Same fix options as above (producer emits the fields, or consumer sources them from `BrokerOrder`/`decisionId`).
`typed-test-fixtures-cross-domain-order-events` does **not** fix production code (spec §2 non-goal) — it
types the fixtures and attributes the balance-value / portfolio-reflects-fill failures here. Severity
upgraded: this is core ledger money math, not only tax-lot tracking. Now QUEUED (rank 1, 2026-06-19),
handed off from the re-scoped consolidated verify; reconcile with `broker-ctrl-order-sf-input-contract-gap`
(the order-execution SF input contract) when implementing the order→ledger money-path fix (Complex lane).
