---
id: service-inventory-fabricated-event-names
status: parking
type: doc
notes: "SERVICE-INVENTORY.md and SYSTEM-ARCHITECTURE.md cite fabricated event names that don't exist in code (POSITION_OPENED/CLOSED/UPDATED, LEDGER_PORTFOLIO_DRIFT_DETECTED, CORPORATE_ACTION_PROCESSED)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Architecture docs cite fabricated event names

HARD-FAIL finding. `docs/architecture/SERVICE-INVENTORY.md:608,647` and
`docs/architecture/SYSTEM-ARCHITECTURE.md:515` cite fabricated event names that don't exist
anywhere in code: `POSITION_OPENED`/`POSITION_CLOSED`/`POSITION_UPDATED`,
`LEDGER_PORTFOLIO_DRIFT_DETECTED`, `CORPORATE_ACTION_PROCESSED`. The actual events are
`BALANCE_UPDATED`, `PORTFOLIO_UPDATED`, `LEDGER_ENTRY_RECORDED`, `PORTFOLIO_DRIFT_DETECTED` (no
rename — the doc's "DRIFT_DETECTED" rename claim is itself wrong), `CORPORATE_ACTION_APPLIED`.
