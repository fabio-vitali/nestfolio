---
id: corrupt-item
status: parking
type: bug
notes: "The REAL corruption class this check was minted from: the unquoted out_of_scope scalar below carries an embedded colon, so YAML parses it as a one-key mapping instead of a string."
references: []
out_of_scope:
  - the unit is now the raw `modelId: string` everywhere.
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# An element-shape-corrupt store item

Bad fixture for the item-store-valid golden gate: backlog-lint passes this file; the schema must not.
