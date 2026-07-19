---
id: broker-sim-adpt-dead-execution-adpt-event-types
status: parking
type: bug
notes: "broker-sim-adpt/domain/events.ts exports an unused, orphaned 14-event ExecutionAdptEventTypes block — copy-paste residue never referenced."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: event-name-integrity
epic_role: core
---

# broker-sim-adpt dead ExecutionAdptEventTypes block

`services/execution/broker-sim-adpt/src/domain/events.ts:3-19` exports an unused, orphaned 14-event
`ExecutionAdptEventTypes` block (copy-paste residue), never referenced in `service.stack.ts` or any
handler. Classic [[event-name-integrity]] case (a): declared, no production emitter and no consumer.
