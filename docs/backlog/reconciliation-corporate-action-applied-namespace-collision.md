---
id: reconciliation-corporate-action-applied-namespace-collision
status: parking
type: bug
notes: "ReconciliationEventTypes.CORPORATE_ACTION_APPLIED duplicates the wire string of the real ExecutionCrossDomainEventTypes constant — an unused shadow declaration."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: event-name-integrity
epic_role: core
---

# reconciliation-ctrl CORPORATE_ACTION_APPLIED namespace collision

`ReconciliationEventTypes.CORPORATE_ACTION_APPLIED`
(`services/ledger/reconciliation-ctrl/src/domain/events.ts:14`) duplicates the same wire string as the
actually-used `ExecutionCrossDomainEventTypes.CORPORATE_ACTION_APPLIED`, an unused shadow constant —
dead/drifting name, [[event-name-integrity]] case (a).
