---
id: ledger-ctrl-undocumented-simulation-branch
status: shipped
type: doc
notes: "ledger-ctrl's DECISION_PACKET_CREATED simulation-write branch is undocumented; advisory-cycle.flow.yaml mischaracterizes it as 'audit'."
references:
  - flows/advisory-cycle.flow.yaml
out_of_scope:
  - Reconciling processSimulationEvent's decisionPacketId read-typing (subject.eventId vs subject.decisionId) — noted in the code as an intentional WS-3 scope boundary, unrelated to this doc fix.
spec: null
plan: null
topic_memory: []
closed: 2026-07-19
validation_gate: "flows/advisory-cycle.flow.yaml: cross_domain DECISION_PACKET_CREATED->LedgerBus hop now documents ledger-ctrl's processSimulationEvent (simulated LedgerEntry write, not audit), evidenced against services/ledger/ledger-ctrl/src/handlers/event-listener.ts:157-210; success_criteria line corrected from 'ledger-adpt (audit, via cross-domain hop)' to 'ledger-ctrl (simulated LedgerEntry write via ledger-adpt cross-domain hop, not audit)'. Doc-layer lane, no code changed, no deploy/e2e gate. Committed on main."
---

# Undocumented ledger-ctrl simulation branch

`ledger-ctrl` subscribes to `DECISION_PACKET_CREATED` and `processSimulationEvent` writes
'simulated' `LedgerEntry` rows, but no flow documents this ledger-side simulation branch;
`advisory-cycle.flow.yaml` mischaracterizes the ledger-adpt consumption as 'audit' rather than
simulation.

Evidence: `services/ledger/ledger-ctrl/src/handlers/event-listener.ts:157-210` vs
`flows/advisory-cycle.flow.yaml:372-376,407`.

Surfaced by the 2026-07-19 pre-ship deploy-gate batch for
`circuit-breaker-lifecycle-e2e-breaker-stuck-open` (audit-domain#7); filing deferred to this
session per Entry 33.
