---
id: delta-2
status: parking
type: task
epic: delta-epic
epic_role: core
notes: "Migrate the second consumer call-site onto the shared retry helper."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# delta-2: Migrate second call-site onto retry helper

Second core member of the delta epic: replace the duplicated retry block at the
second call-site with a call into the shared helper introduced by delta-1.
