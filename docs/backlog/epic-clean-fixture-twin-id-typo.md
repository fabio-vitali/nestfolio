---
id: epic-clean-fixture-twin-id-typo
status: queued
rank: 4
type: tooling
epic: runtime-operationalization
epic_role: core
notes: "epic-clean fixture e.md names its consumer twins rt-epic-* but the shipped scenario ids are rt-bne-ship-clean / rt-bne-e8-auto-no-self-merge — comment drift, grep trap."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# epic-clean fixture doc names the wrong parity-twin ids

Found in the post-ship review of WS-4. `scripts/parity-oracle/fixtures/rt/epic-clean/backlog/e.md:10` says the fixture is used by "`rt-epic-ship-clean`, `rt-epic-auto-no-self-merge`", but the shipped scenarios are `rt-bne-ship-clean` and `rt-bne-e8-auto-no-self-merge` (the `rt-<legacy-id>` convention). Cosmetic comment drift, no runtime effect — but a future session grepping the stated ids finds nothing and may conclude the fixture is orphaned.

**Fix:** correct the two ids in the fixture body. One-line doc edit.

**Promoted 2026-07-08** (parking → queued, rank 4, user-confirmed): named explicitly via `/backlog-next <id> --auto`; drives the runtime-engine soak count (target: soak 3/5 toward the ≥5-workstream soak-gate clause).
