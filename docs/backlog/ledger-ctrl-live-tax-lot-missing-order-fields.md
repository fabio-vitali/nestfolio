---
id: ledger-ctrl-live-tax-lot-missing-order-fields
status: parking
rank: null
type: bug
notes: "Pre-existing latent bug surfaced 2026-06-12 by consumer-parse-subject (WS-3) while typing the ledger-ctrl ORDER_FILLED read. ledger-ctrl/handlers/event-listener.ts live-fill tax-lot path reads subject.symbol / subject.side / subject.quantity / subject.fillPrice off the ORDER_FILLED subject, but the PRODUCER (broker-ctrl order state machine, order-state-machine.ts:106-128 MarkFilledNormalizedEvent) writes ONLY {orderId, executionMode, filledQty, averageFillPrice, timestamp, tenantId/userId/region}. NormalizedOrderEventSchema (broker-ctrl/domain/contracts.ts) codifies exactly that minimal shape; symbol/side are DROPPED at broker-ctrl/callback-resolver.ts (it forwards only filledQty + averageFillPrice from the adapter result into the SF). So for LIVE fills, taxLotManager.openLot/closeLot have been called with symbol=undefined, quantity from a non-existent filledQuantity/quantity field, costBasisPerShare from a non-existent fillPrice — i.e. the live-fill tax-lot tracking never functioned. symbol/side DO survive on the adapter result rows (broker-sim-adpt VirtualTradeSchema has symbol/side/quantity/fillPrice; broker-alpaca-adpt AlpacaOrderResultSchema has symbol/side/requestedQty) and on the BrokerOrder state row (instrumentId/requestedQty), but neither flows into the emitted ORDER_FILLED subject. Fix options: (a) extend broker-ctrl's MarkFilled/MarkPartiallyFilled NormalizedEvent PutItem + NormalizedOrderEventSchema to carry symbol/side/quantity (producer change + deploy + e2e on a real live fill), or (b) have ledger-ctrl source symbol/side from a BrokerOrder GetItem (keyed on orderId) or from the originating decision packet via decisionId. WS-3 did NOT fix this (consumer-typing only) — it types the contract-backed ORDER_FILLED fields (orderId/executionMode/filledQty/averageFillPrice) and confines the symbol/side/quantity reads to ONE documented boundary cast referencing this item, preserving the (broken) prior behavior. Promote when hardening live-money tax-lot tracking, or when extending broker-ctrl's order emissions. Note overlap with broker-ctrl-order-sf-input-contract-gap (the order-execution SF input contract) — both stem from the order path's minimal NormalizedEvent shape."
references: []
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
