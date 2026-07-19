---
id: ledger-simulation-failed-dead-constant
status: parking
type: bug
notes: "LEDGER_SIMULATION_FAILED declared in ledger-ctrl events.ts but never used; real error paths use LEDGER_PROCESSING_FAILED instead."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: event-name-integrity
epic_role: core
---

# ledger-ctrl LEDGER_SIMULATION_FAILED dead constant

`LEDGER_SIMULATION_FAILED` (`services/ledger/ledger-ctrl/src/domain/events.ts:11`) is declared but never
used; real error paths use `LEDGER_PROCESSING_FAILED` and a raw string literal
([[ledger-snapshot-publisher-failed-raw-string-literal]], filed separately as an orphan for the
naming-convention angle). Same [[event-name-integrity]] case (a).
