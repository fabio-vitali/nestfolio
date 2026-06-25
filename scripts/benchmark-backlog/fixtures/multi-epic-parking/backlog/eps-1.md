---
id: eps-1
status: parking
type: task
epic: eps-epic
epic_role: core
notes: "Add an attribute_exists condition so concurrent writes no longer silently drop events."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# eps-1: Close the write-contention drop

Core member of the eps epic: add the conditional-write guard that prevents concurrent
writes from silently overwriting and dropping in-flight events.
