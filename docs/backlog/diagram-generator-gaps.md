---
id: diagram-generator-gaps
status: parking
type: epic
notes: "Architecture-doc generators have coverage gaps that force hand-edits/omissions — C4 lacks the frontend; flow-docs can't express rich sequence diagrams. Theme epic (loose: two generators), 2 members."
done_when: "Each generator covers its gap (C4 represents MFEs at C1/C2; .flow.yaml can express the rich diagrams currently hand-edited) so generated docs need no manual patching; both members shipped or dropped."
scope: "Coverage gaps in the architecture-doc generators (generate-c4-diagrams, tools/generate-flow-docs.mjs + flows/SCHEMA.md) that currently require manual hand-edits."
out_of_scope:
  - "Diagram content correctness for already-represented services (a validation concern, not a generator-coverage gap)"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Diagram-generator coverage gaps

Root cause: the architecture-doc generators don't capture the full picture, forcing hand-edits or omissions — the C4 pipeline doesn't represent MFEs at C1/C2, and tools/generate-flow-docs.mjs can't express the rich sequence diagrams currently only achievable by hand-editing the generated .md. Honest caveat: loose cluster — two separate generators sharing the 'generator doesn't capture the full picture' root. Fix pattern: extend each generator's schema/emitter to cover its gap.

Members (derived from `epic:` pointers):
- `c4-frontend-representation`
- `flow-docs-generator-rich-diagrams`
