---
id: alpaca-account-check-event-unwired
status: parking
type: bug
notes: "broker-alpaca-adpt consumes ALPACA_ACCOUNT_CHECK but no production producer emits it — the circuit-breaker heal SF checks health via direct HTTP:Invoke instead."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: broker-alpaca-adpt-missing-producer-emissions
epic_role: core
---

# ALPACA_ACCOUNT_CHECK has no production producer

`broker-alpaca-adpt` Ingress + `processAccountCheck` handle `ALPACA_ACCOUNT_CHECK`, but the
circuit-breaker heal Step Function does its health check via direct `HTTP:Invoke` to Alpaca
`/v2/account`, not by emitting the event; only tests emit it. A wiring gap, same class as
[[alpaca-order-cancel-requested-dead-path]] (missing production emission on a real functional
path — filed as a plain orphan, not folded into [[event-name-integrity]]).

Evidence: `services/execution/broker-alpaca-adpt/src/service.stack.ts:27` +
`handlers/event-listener.ts:317`; heal SF `HTTP:Invoke` at `service.stack.ts:124-130`.

Surfaced by the 2026-07-19 pre-ship deploy-gate batch for
`circuit-breaker-lifecycle-e2e-breaker-stuck-open` (audit-domain#4); filing deferred to this
session per Entry 33.
