---
id: delta-1
status: parking
type: task
epic: delta-epic
epic_role: core
notes: "Extract the shared retry helper used by both delta call-sites."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# delta-1: Extract shared retry helper

First core member of the delta epic: factor the duplicated retry logic into a single
shared helper so both consumer call-sites can adopt it.
