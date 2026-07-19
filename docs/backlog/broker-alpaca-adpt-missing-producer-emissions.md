---
id: broker-alpaca-adpt-missing-producer-emissions
status: parking
type: epic
notes: "broker-alpaca-adpt has Ingress handlers for events no producer ever emits — designed functional paths left half-wired. Theme epic, 2 members."
done_when: "Each in-scope dead functional path either gets its missing producer wired (the real emission the design called for) or is deliberately deprecated (handler + Ingress removed); both members shipped or dropped."
scope: "broker-alpaca-adpt Ingress+handler pairs that are fully implemented and consumed but have zero production emitter anywhere in the codebase — a missing emission on a real, designed functional path (not a dead/drifting name declaration)."
out_of_scope:
  - "Dead/unwired event-NAME declarations with no consumer either (event-name-integrity) — these members have a real, working consumer side; only the producer side is missing"
  - "Field-shape inconsistency across existing writers (broker-alpaca-emission-shape-drift) — a different root cause (shape drift, not absence)"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# broker-alpaca-adpt missing producer emissions

Root cause: `broker-alpaca-adpt` has fully-built Ingress subscriptions and handlers for two events that no producer anywhere in the codebase ever emits — the designed functional path (account health check via event, order-cancel via event) was wired on the consumer side and then never connected to a real producer. `ALPACA_ACCOUNT_CHECK`'s intended caller (the circuit-breaker heal Step Function) instead does a direct `HTTP:Invoke`; `ALPACA_ORDER_CANCEL_REQUESTED`'s intended caller (the OrderWorkflow SF `EmitCancel` state) was never wired to fire `PutEvents`. Both are explicitly out of the `event-name-integrity` epic's scope (its own out-of-scope note names one of these as the precedent case) since the names aren't dead — they have real, working consumer handlers waiting for input that never arrives. Fix pattern: either wire the missing producer (SF `PutEvents` step) or formally deprecate the dead path (remove the Ingress + handler).

Members (derived from `epic:` pointers):
- `alpaca-account-check-event-unwired`
- `alpaca-order-cancel-requested-dead-path`
