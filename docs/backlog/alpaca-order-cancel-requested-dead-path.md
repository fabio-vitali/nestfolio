---
id: alpaca-order-cancel-requested-dead-path
status: parking
type: bug
notes: "broker-alpaca-adpt consumes ALPACA_ORDER_CANCEL_REQUESTED but no producer emits it — order-cancel path is dead (designed EmitCancel state never wired)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: broker-alpaca-adpt-missing-producer-emissions
epic_role: core
---

# ALPACA_ORDER_CANCEL_REQUESTED order-cancel path is dead

`broker-alpaca-adpt` Ingress + `processCancelRequested` handle `ALPACA_ORDER_CANCEL_REQUESTED`,
but no producer emits it — the OrderWorkflow SF has zero `PutEvents` and the designed
`EmitCancel` state was never wired. This is a missing emission on a real functional path (a flow
gap), not a dead/drifting name, so it is filed as a plain orphan rather than folded into
[[event-name-integrity]] (whose scope explicitly excludes this class, citing the analogous
broker-sim `SIM_ORDER_REJECTED` case).

Evidence: `services/execution/broker-alpaca-adpt/src/service.stack.ts:25` +
`handlers/event-listener.ts:315`; grep finds only the consumer + type defs.

Surfaced by the 2026-07-19 pre-ship deploy-gate batch for
`circuit-breaker-lifecycle-e2e-breaker-stuck-open` (audit-domain#3); filing deferred to this
session per Entry 33.
