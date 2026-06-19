---
id: missing-producer-contract-surface
status: parking
type: epic
notes: "Produced events with no producer-owned zod contract surface, so consumers can't type fixtures or register the event. Theme epic, 2 members."
done_when: "Each in-scope produced event gets a producer-owned zod contract surface (or is relocated to a proper producer home) so it can be typed and registered; both members shipped or dropped."
scope: "Events that ARE produced but have no producer-owned zod contract/exports surface (corporate-action / portfolio-snapshot importers; investor-web USER_REGISTERED/USER_AUTHENTICATED)."
out_of_scope:
  - "Events declared but never emitted at all (account-closure-requested-never-emitted) — a dead declaration, not a missing contract for a live producer"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Missing producer contract surface

Root cause: some events are genuinely produced but have no producer-owned zod contract surface — no schema to register in EventSubjects, so consumer fixtures can't be typed and the registry-driven gate can't see them. Fix pattern: stand up a minimal producer-owned contract surface (package.json exports + tsconfig path + src/domain schema), NOT inside a consumer (which would break producer-ownership).

Members (derived from `epic:` pointers):
- `corporate-action-portfolio-snapshot-no-producer-contract`
- `investor-web-event-contracts-surface`
