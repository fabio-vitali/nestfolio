---
id: order-execution-money-path-leftovers
status: dropped
type: epic
notes: "DISSOLVED 2026-06-29 by backlog-themes: the sole captured member (broker-sim-adpt-no-sim-order-rejected-emission) re-homed to the sharper order-execution-lifecycle-resilience theme. Holding bucket emptied → dropped (its done_when 'each residual finding... re-clustered by backlog-themes' is satisfied). Originally auto-spun-out when order-execution-money-path shipped (2026-06-22)."
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

**Dissolved 2026-06-29** by a `backlog-themes` sweep. The invited re-home happened: the sole captured
member `broker-sim-adpt-no-sim-order-rejected-emission` moved onto the new
[[order-execution-lifecycle-resilience]] theme (joining the `execution-ctrl-mandate-recheck-order-boundary`
orphan under the shared "adverse order-lifecycle path handled via coarse timeout / tolerated race" root
cause). With no members remaining, this provenance bucket is **dropped** — its `done_when`
("each residual finding... re-clustered by backlog-themes into a sharper root-cause theme") is satisfied.

Members: none (re-homed to `order-execution-lifecycle-resilience`).
