---
id: bff-read-model-semantic-gaps
status: parking
type: epic
notes: "A BFF read-model materializes correctly (single-writer ownership satisfied) but lacks the semantic richness/sub-state a UI feature needs; the fix sources a new signal, not a richer re-materialization. Theme epic, 2 members."
done_when: "Each in-scope BFF read-model surfaces the semantic signal/sub-state its UI needs, sourced from the right event or projection (cross-domain subscription or status projection); both members shipped or dropped."
scope: "BFF read-model completeness gaps where the row materializes correctly but the projected data is semantically insufficient for the UI — a missing activity sub-state, or a generic event-type/payload where the UI needs the originating cause."
out_of_scope:
  - "Read-model ownership / materialization correctness bugs — those are read-model-ownership work; these items' rows are already correctly owned and materialized"
  - "BFF state-completeness shortcuts (route-state/in-memory) — these are about projected SEMANTICS, the row already survives a refresh"
references: []
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
validation_gate: null
---

# BFF read-model semantic gaps

Root cause: the single-writer read-model-ownership model is satisfied — the BFF row materializes correctly — but the data it projects is semantically too thin for the UI feature that needs it. A correct materialization of the wrong/insufficient signal is still a gap: the dashboard activity feed has no "awaiting confirmation" sub-state (its only producer was a dead event), and ledger order-history shows generic `LEDGER_ENTRY_RECORDED` snapshot summaries instead of the originating order events (symbol/qty/price/side). Fix pattern: source a new signal — a cross-domain subscription or a status projection on the existing row — rather than re-materializing the same insufficient event more richly.

Members (derived from `epic:` pointers):
- `dashboard-bff-awaiting-confirmation-activity-gap`
- `ledger-bff-order-history-generic-eventtype`
