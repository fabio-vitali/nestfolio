---
id: broker-ctrl-order-sf-input-contract-gap
status: active
epic: order-execution-money-path
epic_role: core
type: bug
notes: "POTENTIALLY SIGNIFICANT (investigate before parking long). broker-ctrl's OrderStateMachine reads order fields (tenantId/orderId/symbol/side/quantity) from the TOP of its input ($.detail.* via RuleTargetInput.fromEventPath('$.detail')), but the real ORDER_SUBMITTED is CDC-emitted from execution-ctrl's Order row whose subject carries {orderId, decisionPacketId, proposedTrades, status} — NOT symbol/side/quantity, and nested under the standard subject/context envelope. No integration OR e2e test drives the order-execution SF end-to-end, so this path appears UNEXERCISED. If real: L1 auto-execute orders never route through the SF correctly (ReadExecutionMode would build ExecutionMode#<undefined>). The typed-subject-contracts-execution e2e gate could NOT drive it and documented NormalizedOrderEvent as a boundary. Promote/investigate: confirm whether real orders execute via this SF in prod (CloudWatch on a real DECISION_APPROVED→order), and reconcile the SF input contract with the actual ORDER_SUBMITTED shape. WS-3 of order-execution-money-path (spec 2026-06-19-order-execution-money-path-design.md): CONFIRMED REAL 2026-06-19 — dev SF 881/881 FAILED at ReadExecutionMode ($.tenantId not found; identity is under $.context, order data under $.subject). Scope under the money-path design = break A (fix ASL JSONPath: identity from $.context, order data from $.subject) PLUS break D producer (MarkFilledNormalizedEvent + NormalizedOrderEventSchema gain symbol/side, composed from the bound order $.subject). Gated behind WS-1+WS-2 (needs single-symbol ORDER_SUBMITTED carrying symbol/side/amount); promote to QUEUED when WS-2 ships. Complex lane."
references: []
out_of_scope:
  - "execution-ctrl producer changes (per-trade Order expansion + ORDER_SUBMITTED enrichment) — shipped in WS-2 execution-ctrl-per-trade-order-expansion"
  - "ledger-ctrl consumer typing of RecordFill (break D consumer) — WS-4 ledger-ctrl-live-tax-lot-missing-order-fields"
  - "real-path accept-decision e2e + execution-ctrl integration test + flow-spec sync — WS-5 order-execution-money-path-real-e2e"
  - "amount→shares conversion logic inside broker-sim-adpt beyond aligning route-order/BrokerOrderSchema denomination to what the adapter already expects"
spec: docs/superpowers/specs/2026-06-19-order-execution-money-path-design.md
plan: null
topic_memory: [project_event_subject_contracts.md]
---

# broker-ctrl OrderStateMachine input-contract gap (order-execution SF unexercised)

Surfaced 2026-06-10 during `typed-subject-contracts-execution` (slice 3) while building the
e2e gate to validate broker-ctrl's `NormalizedOrderEvent` (ORDER_FILLED/etc.) against a real
emission. The gate could not drive the OrderStateMachine and documented NormalizedOrderEvent
as a unit-validated boundary instead.

## What (the apparent mismatch)

- `broker-ctrl/src/state-machine/order-state-machine.ts`: `ReadExecutionMode` builds the DDB
  key from `$.tenantId` (top of the SF input); `RouteOrder` passes the whole input as
  `order` and downstream reads `$.orderId`/`$.symbol`/`$.side`/`$.quantity`/`$.userId`/`$.region`.
- The Orchestration construct wires the EB→SF target with `RuleTargetInput.fromEventPath('$.detail')`,
  so the SF input `$` == the EB event's `detail`.
- The OrderStateMachine triggers on `ORDER_SUBMITTED`, which is CDC-emitted by **execution-ctrl**
  from its `Order` row. That subject carries `{orderId, decisionPacketId, proposedTrades, status, ...}`
  under the standard `detail.subject` envelope (with identity in `detail.context`) — it does
  **not** carry `tenantId`/`symbol`/`side`/`quantity` at the top of `detail`.

So as read statically, the SF would compute `ExecutionMode#<undefined>` (GetItem miss) and lack
symbol/side/quantity for routing. **No integration test and no e2e test drives this SF
end-to-end** (broker-ctrl integration tests trap order events but don't run the order SF;
the new e2e gate validates the adapters directly).

## Why this matters

If the gap is real, **L1 auto-execute orders never route correctly through broker-ctrl's
OrderStateMachine** — a production order-execution defect. The system has been demoed executing
orders (Playwright e2e, inter-agent work), so EITHER (a) orders execute via this SF and the
static read is incomplete (e.g. the CDC publisher flattens `detail`, or the EB target differs),
OR (b) the order SF path is genuinely unexercised and "execution" so far has been synthetic
fixtures (`withHoldings` injects ORDER_FILLED directly). **This needs empirical confirmation,
not static reasoning — do not park indefinitely without investigating.**

## Investigation / fix direction

1. Trigger a real `DECISION_APPROVED` → execution-ctrl `Order(SUBMITTED)` → CDC `ORDER_SUBMITTED`
   during market hours and watch CloudWatch: does the OrderStateMachine start + succeed, or fail
   at `ReadExecutionMode`? Inspect the actual `ORDER_SUBMITTED` EB `detail` shape.
2. Reconcile the SF input contract with the real ORDER_SUBMITTED: either shape the SF reads to
   `$.subject.*`/`$.context.tenantId`, derive symbol/side/quantity from `proposedTrades`, or
   change the EB target transform.
3. Add an e2e scenario that drives the real order-execution SF end-to-end (the typed-subject
   gate's NormalizedOrderEvent leg can then be promoted from boundary to asserted).

See [[project_event_subject_contracts]].
