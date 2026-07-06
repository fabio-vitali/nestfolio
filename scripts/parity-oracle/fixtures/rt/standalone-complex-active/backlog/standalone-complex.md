---
id: standalone-complex
status: active
type: refactor
scope: "services/**"
out_of_scope:
  - "Consumer migration — ships separately after the API change."
notes: "Redesign the public EventBus publish API — breaking change to all consumers, requires major version bump."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# standalone-complex: Refactor public EventBus publish API

Standalone public-interface-changing refactor: rename and re-type the primary EventBus
publish method to align with the new envelope schema. This is a breaking change requiring
a major semver bump. All downstream consumers must be migrated after this ships.

Declared scope: `services/**` — any diff outside that scope is a scope-gate escape.
