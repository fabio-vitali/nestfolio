---
id: delta-epic
status: parking
type: epic
notes: "Theme epic with two core members — promotable as-is (done_when + scope + out_of_scope all present)."
done_when: "Both delta core members are shipped and the shared retry helper is in place."
scope: "The delta surface: a shared retry helper and its two consumer call-sites."
out_of_scope:
  - Reworking unrelated error-handling paths.
  - Any real deploy or e2e run — this fixture exists solely for sandbox tests.
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Epic: Delta

Theme (parking) epic with two parking core members. It already carries done_when,
scope, and out_of_scope, so a promote-to-active step can adopt it without edits.
