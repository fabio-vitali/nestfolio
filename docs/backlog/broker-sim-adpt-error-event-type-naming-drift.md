---
id: broker-sim-adpt-error-event-type-naming-drift
status: parking
type: tooling
notes: "broker-sim-adpt event-listener.ts uses errorEventType 'EXECUTION_ADPT_FAILED' instead of the repo convention BROKER_SIM_ADPT_FAILED."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: error-event-name-string-literal-drift
epic_role: core
---

# broker-sim-adpt error event type naming drift

`services/execution/broker-sim-adpt/src/handlers/event-listener.ts:176` uses
`errorEventType: 'EXECUTION_ADPT_FAILED'` instead of the repo-wide `<SERVICE>_FAILED` convention
(`BROKER_SIM_ADPT_FAILED`). Same copy-paste root cause as
[[broker-sim-adpt-dead-execution-adpt-event-types]] (a dead `ExecutionAdptEventTypes` block in the
same package).
