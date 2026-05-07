---
id: bump-tsconfig-es2022-to-es2023
status: parking
type: tooling
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "Enable .toSpliced/.toReversed/.with workspace-wide; promote on second use case."
---

# Bump `tsconfig.base.json` `lib` from ES2022 → ES2023

To enable `.toSpliced` / `.toReversed` / `.with` and other immutable array methods workspace-wide. Surfaced 2026-05-02 during Task 6 review of `feat/decision-list-pattern-b` — `apps/advisory-mfe/src/app/decision-list/decision-list.component.ts:194` could read more clearly as `current.toSpliced(idx, 1)` than `current.filter((_, i) => i !== idx)`. Workspace-scope change touching every project's type-checking; not Task 6 scope. Promote when at least one more caller would benefit.
