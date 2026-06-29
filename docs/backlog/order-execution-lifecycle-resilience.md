---
id: order-execution-lifecycle-resilience
status: parking
type: epic
notes: "Order-lifecycle adverse-path resilience theme (minted 2026-06-29 by backlog-themes, re-homing the sole order-execution-money-path-leftovers member per that bucket's own invitation): the order-execution path doesn't cleanly handle adverse (non-happy-path) lifecycle conditions — a rejection or a late mandate revoke — so it leans on a coarse SF timeout or tolerates a sub-second race instead of a deterministic clean outcome. Theme epic, 2 members."
done_when: "Each in-scope adverse order-lifecycle condition resolves to a deterministic, clean terminal outcome rather than a coarse SF timeout escalation or a tolerated TOCTOU race — a rejected sim order emits a clean rejection callback, and the L1 auto-execute path re-checks mandate at the order-placement boundary; all members shipped or dropped."
scope: "Order-execution adverse-path (non-happy-path) lifecycle gaps where the current design relies on a coarse SF timeout or accepts a race: (1) broker-sim-adpt never emits SIM_ORDER_REJECTED, so a rejected sim order has no callback event and escalates via the 1h OrderStateMachine timeout instead of resolving the task token to a clean REJECTED; (2) execution-ctrl does not re-read its local mandate projection before broker submission on the L1 auto-execute path, leaving a sub-second revoke-between-APPROVED-and-submission TOCTOU race."
out_of_scope:
  - "The happy funded-buy → fill → ledger → portfolio path — already proven by the shipped order-execution-money-path accept-decision e2e; this theme is strictly the adverse branches."
  - "broker-alpaca-adpt emission-shape drift (broker-alpaca-emission-shape-drift) — a real-broker contract-shape cause, not an adverse-lifecycle-handling gap."
references: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# Order-execution lifecycle resilience — adverse-path handling

Root cause: the order-execution path is designed and proven for the **happy path** (funded buy →
fill → ledger → portfolio). Its **adverse** branches — an order *rejection*, or a mandate *revoked*
in the sub-second window between compliance APPROVAL and broker submission — are not handled to a
clean deterministic terminal outcome. Instead they fall back on a **coarse SF timeout** (1h
`OrderStateMachine` → ESCALATED) or **tolerate a TOCTOU race**. The wiring to do better already
exists on both (the `SIM_ORDER_REJECTED` ingress / `callback-resolver` is built and ready; each
consumer already keeps a fast local mandate projection) — what's missing is the producer/boundary
step that turns the adverse condition into a clean signal.

This theme was minted by re-homing the sole member of the auto-spun-out
`order-execution-money-path-leftovers` bucket (whose body explicitly invited re-clustering "onto a
broker-sim / order-lifecycle resilience theme") and joining it with the standalone mandate-recheck
orphan that shares the adverse-path-resilience cause. Draining it makes both adverse branches resolve
deterministically rather than via timeout / race.

Members (derived from `epic:` pointers):
- `broker-sim-adpt-no-sim-order-rejected-emission` (rejected sim order emits no callback → 1h SF timeout → ESCALATED instead of a clean REJECTED; the `SIM_ORDER_REJECTED` ingress is wired but never fired)
- `execution-ctrl-mandate-recheck-order-boundary` (no mandate re-read before broker submission on the L1 auto-execute path → sub-second revoke-after-APPROVED TOCTOU race; cheapest mitigation re-reads the local projection and fails the order `REVOKED_AFTER_APPROVAL`)

See [[project_event_subject_contracts]].
