---
id: design-spec-only
status: queued
rank: 30
type: design
notes: "A design workstream whose entire done-definition is the design doc landing — no code, stays Doc-layer."
references:
  - "docs/specs/design-spec-only-design.md#design-spec-only-landing-criteria"
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# design-spec-only: Design-doc-only workstream

A `type: design` workstream. Its done-definition is purely that the referenced design document
lands and its decisions are recorded — there is no implementation to write, no service to touch,
no deploy. A spec/design-only workstream stays in the **Doc-layer** lane: it works on `main` and
opens no code worktree.
