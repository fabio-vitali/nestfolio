---
id: advisory-authorizing-events-carry-proposed-trades
status: queued
epic: order-execution-money-path
epic_role: core
rank: 1
type: refactor
notes: "WS-1 of the order-execution money-path repair (spec 2026-06-19-order-execution-money-path-design.md §4 hop 1, §7). Root cause of the broken money path: trade details never enter the execution domain — execution-ctrl's DECISION_APPROVED + USER_CONFIRMED handlers both hard-code proposedTrades:[] ('they ride RECOMMENDATION_PROPOSED', which execution-ctrl never consumes). Fix: both authorizing-event producer contracts carry proposedTrades in their subject, and the producers stamp the real trades. DECISION_APPROVED: compliance-ctrl (ComplianceCheckSchema, services/advisory/compliance-ctrl/src/domain/contracts.ts:18) already receives proposedTrades on RECOMMENDATION_PROPOSED → forward them onto DECISION_APPROVED. USER_CONFIRMED: advisory-bff confirmDecision is an intent-only JS resolver; stamp proposedTrades onto the UserConfirmation row by reading them from the decision read model (pin the exact resolver + UserConfirmationSchema owner — advisory-adpt/domain re-exports it — in the plan). ProposedTrade = {symbol, side, quantityOrAmountCents} (amount-denominated; advisory-adpt/domain/contracts.ts:8 ProposedTradeSchema). Complex lane (cross-domain producer contracts + JS resolver + deploy + integration). Lead slice — adopt first."
references: []
out_of_scope: []
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
