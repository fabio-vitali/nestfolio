---
id: advisory-authorizing-events-carry-proposed-trades
status: active
epic: order-execution-money-path
epic_role: core
type: refactor
notes: "WS-1 of the order-execution money-path repair (spec 2026-06-19-order-execution-money-path-design.md §4 hop 1, §7). Root cause of the broken money path: trade details never enter the execution domain — execution-ctrl's DECISION_APPROVED + USER_CONFIRMED handlers both hard-code proposedTrades:[] ('they ride RECOMMENDATION_PROPOSED', which execution-ctrl never consumes). Fix: both authorizing-event producer contracts carry proposedTrades in their subject, and the producers stamp the real trades. DECISION_APPROVED: compliance-ctrl (ComplianceCheckSchema, services/advisory/compliance-ctrl/src/domain/contracts.ts:18) already receives proposedTrades on RECOMMENDATION_PROPOSED → forward them onto DECISION_APPROVED. USER_CONFIRMED: advisory-bff confirmDecision is an intent-only JS resolver; stamp proposedTrades onto the UserConfirmation row by reading them from the decision read model (pin the exact resolver + UserConfirmationSchema owner — advisory-adpt/domain re-exports it — in the plan). ProposedTrade = {symbol, side, quantityOrAmountCents} (amount-denominated; advisory-adpt/domain/contracts.ts:8 ProposedTradeSchema). Complex lane (cross-domain producer contracts + JS resolver + deploy + integration). Lead slice — adopt first."
references: []
out_of_scope:
  - "execution-ctrl's consumption of proposedTrades (typed Order schema, per-trade Order expansion, ORDER_SUBMITTED enrichment) — that is WS-2"
  - "broker-ctrl SF input-contract fix + ORDER_FILLED enrichment — WS-3"
  - "ledger-ctrl RecordFill typing — WS-4"
  - "Redesigning the operating-mode L1/L2 authority model — WS-1 only confirms DECISION_APPROVED vs USER_CONFIRMED stay mutually exclusive for order creation, it does not change which event fires when"
  - "Changing RECOMMENDATION_PROPOSED or the decision-packet contract (the trades already ride it) — WS-1 forwards/stamps from existing data, no new upstream contract"
spec: docs/superpowers/specs/2026-06-19-order-execution-money-path-design.md
plan: null
topic_memory: []
validation_gate: null
---

# WS-1 — authorizing events carry proposedTrades

See spec §4 hop 1 + §8 (USER_CONFIRMED producer pin, double-trigger guard). DECISION_APPROVED
(compliance-ctrl) and USER_CONFIRMED (advisory-bff) gain `proposedTrades: ProposedTrade[]` on their
subject; producers stamp the real trades they already hold. Unblocks WS-2 (execution-ctrl reads
them off the event it already consumes).
