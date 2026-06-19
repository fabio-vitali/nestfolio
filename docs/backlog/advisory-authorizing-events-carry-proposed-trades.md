---
id: advisory-authorizing-events-carry-proposed-trades
status: shipped
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
plan: docs/superpowers/plans/2026-06-19-ws1-advisory-authorizing-events-proposed-trades.md
topic_memory: []
validation_gate: "Shipped on feat/advisory-authorizing-events-carry-proposed-trades. Code: c891e351 (compliance-ctrl writes proposedTrades onto ComplianceCheck row + ComplianceCheckSchema → DECISION_APPROVED/BLOCKED), 3a5a2f8f (advisory-bff confirm-decision.fn.js stamps proposedTrades from ctx.prev.result onto UserConfirmation row + UserConfirmationSchema → USER_CONFIRMED), 45f5989f (fallback fix — DECISION_BLOCKED mandate-missing path also carries proposedTrades; deployed-dev integration caught the happy-path-only gap), d2e087d9 (service-card regen). Both fields OPTIONAL + opaque (z.array(z.unknown()).optional()); typed parse deferred to WS-2. Static: affected closure (compliance-ctrl/advisory-bff/advisory-adpt/decision-workflow-ctrl/execution-ctrl/test-contracts) test+lint green; additive optional field → existing typed fixtures valid, check-typed-fixtures unaffected. Deploy: dev-compliance-ctrl + dev-advisory-bff UPDATE_COMPLETE (confirmDecision resolver fn updated). Integration vs deployed dev: compliance-ctrl 15/15 (proposedTrades round-trips on DECISION_APPROVED/BLOCKED subject), advisory-bff 10/10 (confirmDecision UserConfirmation row + USER_CONFIRMED subject carry proposedTrades). Final whole-branch review (opus): Ready to merge, zero must-fix. WS-1 unblocks WS-2 (execution-ctrl reads proposedTrades off the authorizing event it already consumes)."
---

# WS-1 — authorizing events carry proposedTrades

See spec §4 hop 1 + §8 (USER_CONFIRMED producer pin, double-trigger guard). DECISION_APPROVED
(compliance-ctrl) and USER_CONFIRMED (advisory-bff) gain `proposedTrades: ProposedTrade[]` on their
subject; producers stamp the real trades they already hold. Unblocks WS-2 (execution-ctrl reads
them off the event it already consumes).
