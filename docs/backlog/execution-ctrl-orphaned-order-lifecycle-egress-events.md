---
id: execution-ctrl-orphaned-order-lifecycle-egress-events
status: parking
type: bug
notes: "ORDER_UPDATED / STAGED_ORDER_CREATED / STAGED_ORDER_UPDATED egress mappings have zero consumers and appear in no flow spec — emitted into the void."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: event-name-integrity
epic_role: core
---

# execution-ctrl orphaned order-lifecycle egress events

`ORDER_UPDATED`, `STAGED_ORDER_CREATED`, `STAGED_ORDER_UPDATED` egress mappings
(`services/execution/execution-ctrl/src/service.stack.ts:34-42`) have zero consumers anywhere and appear
in no flow spec — emitted into the void. Same "dead consumer" shape as
[[advisory-narrative-ctrl-decision-feedback-dead-consumer]].
