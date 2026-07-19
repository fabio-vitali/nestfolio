---
id: ledger-ctrl-modify-events-undocumented
status: parking
type: bug
notes: "BALANCE_EVENT_UPDATED / PORTFOLIO_EVENT_UPDATED / LEDGER_ENTRY_EVENT_UPDATED egress events appear in no flow spec and no adapter forwards them cross-domain."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: event-name-integrity
epic_role: core
---

# ledger-ctrl modify events undocumented in flow specs

`BALANCE_EVENT_UPDATED`, `PORTFOLIO_EVENT_UPDATED`, `LEDGER_ENTRY_EVENT_UPDATED` (Egress
`services/ledger/ledger-ctrl/src/service.stack.ts:111-123`) appear in no flow spec and no adapter
forwards them cross-domain — same "dead consumer" shape as
[[execution-ctrl-orphaned-order-lifecycle-egress-events]].
