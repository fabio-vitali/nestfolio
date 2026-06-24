---
id: standalone-complex
status: queued
rank: 30
type: refactor
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
