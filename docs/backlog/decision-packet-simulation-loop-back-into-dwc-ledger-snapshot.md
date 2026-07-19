---
id: decision-packet-simulation-loop-back-into-dwc-ledger-snapshot
status: parking
type: bug
notes: "Traced complete cycle: DWC simulation write -> unfiltered PORTFOLIO_UPDATED -> advisory-adpt -> DWC's own next-cycle snapshot projector consumes it."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: simulation-streamtype-guard-gap
epic_role: core
---

# Decision packet simulation loops back into DWC's own next-cycle ledger snapshot

Traced complete cycle: DWC `DECISION_PACKET_CREATED` -> ledger-ctrl simulated write ->
`PORTFOLIO_UPDATED` (unfiltered per [[simulated-portfolio-corrupts-real-balance-readmodel]]) ->
advisory-adpt pulls it back -> DWC's own `SnapshotProjectorIngress` consumes it into the next
cycle's ledger context. Distinct from the already-shipped `ledger-ctrl-undocumented-simulation-branch`
item, which only documented the simulation branch's existence, not this data-integrity
feedback-loop gap.
