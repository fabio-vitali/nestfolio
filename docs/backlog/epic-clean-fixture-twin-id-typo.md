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

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-08
- **Decision:** Named /backlog-next target epic-clean-fixture-twin-id-typo was status: parking (rule 8 dispatch refuses parking). Promote and work now, or leave parked?
- **Options:** Promote to queued rank 4 and proceed with --auto | Promote only, do not run | Leave in parking
- **Chosen:** Promote to queued rank 4 and proceed with --auto (user-confirmed via AskUserQuestion)
- **Rationale:** Item named explicitly by the user; one-line fixture-comment fix; drives the runtime-engine soak count toward the soak-gate clause (3/5 target).
- **Rejected:** Leaving it parked defers a grep-trap that misleads future sessions into concluding the epic-clean fixture is orphaned.

### D2 — 2026-07-08
- **Decision:** The stale rt-epic-* ids also appear in docs/superpowers/plans/2026-07-07-runtime-replatform-next-epic.md — update the plan doc too, or fix only the fixture?
- **Options:** Fix only the fixture (leave plan doc as historical record) | Also rewrite the plan doc ids
- **Chosen:** Fix only the fixture (leave plan doc as historical record)
- **Rationale:** The plan is a point-in-time artifact; the rt-<legacy-id> rename happened deliberately at WS-4 ship. Retro-editing shipped plans falsifies the historical record; the backlog item scopes the fix to the fixture body.
- **Rejected:** Rewriting the plan doc would erase the recorded before-state of a decision the ship already documented.
