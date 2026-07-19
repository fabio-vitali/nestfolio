---
id: ledger-ctrl-undocumented-simulation-branch
status: parking
type: doc
notes: "ledger-ctrl's DECISION_PACKET_CREATED simulation-write branch is undocumented; advisory-cycle.flow.yaml mischaracterizes it as 'audit'."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
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
