---
id: advisory-narrative-ctrl-decision-feedback-dead-consumer
status: parking
type: bug
notes: "advisory-narrative-ctrl subscribes to DECISION_FEEDBACK but no producer anywhere emits it — dead consumer wiring."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: event-name-integrity
epic_role: core
---

# advisory-narrative-ctrl DECISION_FEEDBACK dead consumer

advisory-narrative-ctrl's Ingress + `event-listener.ts`/`feedback-correlator.ts` handle
`DECISION_FEEDBACK`, but no service, AppSync mutation, or Step Function emits it anywhere in the
repo (advisory-bff resolvers never publish it).

Evidence: `services/advisory/advisory-narrative-ctrl/src/service.stack.ts:41` +
`handlers/event-listener.ts:171`; grep `DECISION_FEEDBACK` finds only
`decision-workflow-ctrl/src/domain/events.ts:10` (definition) + this consumer.

Surfaced by the 2026-07-19 pre-ship deploy-gate batch for
`circuit-breaker-lifecycle-e2e-breaker-stuck-open` (audit-domain#1); filing deferred to this
session per Entry 33.
