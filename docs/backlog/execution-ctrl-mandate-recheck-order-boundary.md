---
id: execution-ctrl-mandate-recheck-order-boundary
status: parking
type: refactor
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "Defense-in-depth — re-read mandate before broker submission on L1 auto-execute."
epic: order-execution-lifecycle-resilience
epic_role: core
---

# execution-ctrl mandate re-check at order-placement boundary (defense-in-depth)

Today's design relies on each consumer (compliance-ctrl, execution-ctrl) keeping a fast local mandate projection and reading fresh at decision time. Empirical timing 2026-05-05: SF cycle 42–80s wall-clock vs projection write mean 158ms / max 998ms (~300×) — so the production race is structurally absent for the compliance read. The one residual sub-second gap: a user revoking BETWEEN compliance-ctrl APPROVED and execution-ctrl placing the order on the L1 auto-execute path. Cheapest mitigation: `services/execution/execution-ctrl/src/` reads its local mandate projection one more time before broker submission; fail order with `REVOKED_AFTER_APPROVAL` reason if status changed. First step before promoting: verify whether such a check already exists. This is the only architectural improvement worth filing from the 2026-05-05 self-contained-event design exercise (the rest was over-engineering a non-problem — see the spec that was drafted and retired in commits `74f55961` then deleted).
