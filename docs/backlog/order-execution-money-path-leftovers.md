---
id: order-execution-money-path-leftovers
status: parking
type: epic
notes: "Auto-spun-out when the order-execution-money-path delivery epic shipped (2026-06-22) with all 5 core members terminal and the accept-decision real-path e2e green. Holds the genuinely-orthogonal captured member(s) for later re-clustering by backlog-themes."
done_when: "Each residual finding spun out of the order-execution-money-path epic is resolved, dropped, or re-clustered by backlog-themes into a sharper root-cause theme; all members shipped or dropped."
scope: "The genuinely-orthogonal captured findings surfaced by the order-execution money-path program: the sim order REJECTED-path emission gap (broker-sim-adpt never emits SIM_ORDER_REJECTED, so rejected sim orders escalate via the 1h SF timeout instead of a clean ORDER_REJECTED)."
out_of_scope:
  - "Anything load-bearing for the order-execution-money-path done_when — by construction none of these are (the green accept-decision real-path e2e proves the happy fill path works without them); each rides the REJECTED path, orthogonal to the happy-path done_when."
references: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# order-execution-money-path — residual findings (leftovers)

Auto-spun-out when the `order-execution-money-path` delivery epic shipped (2026-06-22) with all 5
core members terminal and the `accept-decision` real-path e2e green. These are the **captured**
members that rode along for unified session context but are **genuinely orthogonal** to the epic's
`done_when` (the happy funded-buy → fill → ledger → portfolio path). The epic's done-definition is
satisfied without them — the green real-path e2e independently proves the fill path works.

This is a **holding bucket pending re-clustering** by `backlog-themes`. Run `backlog-themes` to
redistribute (this residue may re-home onto a broker-sim / order-lifecycle resilience theme).

Members (derived from `epic:` pointers):
- `broker-sim-adpt-no-sim-order-rejected-emission`
