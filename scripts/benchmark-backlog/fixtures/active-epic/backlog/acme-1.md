---
id: acme-1
status: active
type: task
epic: acme-epic
epic_role: core
notes: "Redesign the public EventBus interface — breaking change to all consumers."
out_of_scope:
  - Migrating downstream consumers — handled in acme-2.
  - Performance tuning.
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# acme-1: Redesign public EventBus interface

Public-interface-changing task: rename and re-type the primary EventBus publish method
to align with the new envelope schema. This is a breaking change requiring a major bump.
