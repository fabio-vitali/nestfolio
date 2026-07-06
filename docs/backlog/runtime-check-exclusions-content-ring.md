---
id: runtime-check-exclusions-content-ring
status: shipped
closed: 2026-07-06
type: refactor
epic: runtime-operationalization
epic_role: core
notes: "Split from runtime-check-migration-completion 2026-07-06. Relocate the 8 tools/*-exclusions.json sidecars under runtime/content/exclusions/ and make the dangling exclusionsRoot config pointer real. Today: sidecars read by each check-*.mjs via hardcoded tools/ paths; also referenced by runtime/engine/backward/dogfood/lessons.mjs (2), nx inputs in libs/event-processor/project.json (3), and test fixtures; scope.exclusions is metadata-only (runtime never reads it); exclusionsRoot is declared but unread. Mechanism choice (relocate-only vs engine-owned resolution) is this item's own design call. Orthogonal to 'checks run on a cadence' — the migrated checks already run correctly with their tools/ sidecars."
references: []
out_of_scope:
  - "Engine-owned exclusion resolution (runtime reading scope.exclusions via exclusionsRoot and injecting into cmd: checks) — a ring-1 contract change frozen by the epic. This member is relocate-only per Decision D1; scope.exclusions stays metadata-only."
  - "tools/typed-fixture-registered-events.json — an allowlist registry, not an exclusions sidecar; not relocated."
  - "Changing the CONTENTS of any exclusion list — relocation preserves each sidecar's entries verbatim; no path is added or removed."
  - "The check cadence / SPEC §12 migration surface — orthogonal; the migrated checks already run correctly with their sidecars."
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: "Relocate-only (D2): 8 tools/*-exclusions.json → runtime/content/exclusions/ (git renames, 100%), new tools/lib/exclusions-root.mjs reads exclusionsRoot from runtime.config.json (now a real, cwd-independent config pointer), all 8 checks build their path via exclusionsFile(name). Consumers repointed: 8 checks, 2 lessons.mjs scope.exclusions, 4 content-ring YAML, 3 project.json nx check-target inputs + nx-graph fixture, 3 check test-fixture trees, comments, and all live doc refs (CLAUDE.md, arch docs, 7 skills, broker-ctrl card) — D3. Impl commit 7845160b. Evidence: 98 check tests green (node --test, all 8 suites + text-scan); real runs — all 8 checks read the relocated sidecars (read-model/service-card/ddb-seed/agent-result-fallback/ddb-scan/states-runtime/unsafe-cast clean; check-typed-subjects' 2 subject-suffix reds are pre-existing on origin/main and unrelated, tracked in broker-ctrl-sim-funding-subject-suffix-rename); nx run-many test,lint over 36 affected = 35/36 green in-worktree, sole failure agent-orchestrator:test is a worktree-symlink transitive-dep (@smithy/util-stream) artifact — green on pristine main (19 suites/129 tests), untouched by the diff; ship-recheck clean (ship:runtime-check-exclusions-content-ring:gate-clean); mint considered → none. No deploy: detect-deploy-needed flagged deploy=true only from the project.json check-target-input edit (not build → byte-identical artifact) + broker-ctrl/CLAUDE.md (a doc); sidecars are dev-time gate config never read by a deployed Lambda — user-confirmed skip."
---

# Relocate exclusion sidecars into the content ring (make exclusionsRoot real)

Split from `runtime-check-migration-completion` on 2026-07-06 (its exclusions scope decision). The 8
`tools/*-exclusions.json` sidecars are a body-bullet cleanup, NOT a SPEC §12 migration surface — orthogonal
to making checks run on a cadence, so they were carved out of the deterministic-tier workstream.

## Scope

- Move the 8 sidecars → `runtime/content/exclusions/`
  (`agent-result-fallback`, `ddb-scan`, `ddb-seed`, `read-model`, `service-card`, `states-runtime`,
  `typed-subject`, `unsafe-cast`).
- Repoint every consumer: each `tools/check-*.mjs` hardcoded `SIDECAR`/`EXCLUSIONS_FILE` constant, the
  `scope.exclusions:` fields on CheckEntries (3 today, pointing at old `tools/` paths), the 2
  `runtime/engine/backward/dogfood/lessons.mjs` refs, the 3 nx inputs in
  `libs/event-processor/project.json`, and any test fixtures.
- Decide + implement the **mechanism** (this item's own design call): **relocate-only** (tools still
  self-read from the new config-driven location; `exclusionsRoot` = the base path) vs **engine-owned**
  (the runtime resolves `scope.exclusions` via `exclusionsRoot` and passes exclusions into `cmd:` checks —
  a ring-1 contract change).
- Result: no dangling `exclusionsRoot`; one owned location for check exclusions.

Note `tools/typed-fixture-registered-events.json` is an allowlist registry, not an exclusions file —
out of scope.

## Decision log

<!-- append-only (F-6): entries are never edited or removed; a reversal is a NEW entry referencing the superseded one. Written by decision-log.mjs — do not hand-edit. -->

### D1 — 2026-07-06
- **Decision:** Drain runtime-check-exclusions-content-ring as a standalone /backlog-next member PR (promote parking->active) rather than via the epic orchestrator
- **Options:** standalone /backlog-next member PR (epic stays parking, tracking role) | run runtime-operationalization through /backlog-next-epic (one-branch/one-PR) | split the epic into sub-epics first
- **Chosen:** standalone /backlog-next member PR
- **Rationale:** Honors epic Decision D1 (2026-07-05): orchestrator one-branch mode was wound down because P5 (work-driver-replatform) needs a >=5-merged-workstream soak that deadlocks under one-branch/one-PR; the epic scope already declares per-member PR draining. User confirmed via AskUserQuestion. No rule-8 trigger language on this member, so parking->active is a mechanical prerequisite, not a silent promotion.
- **Rejected:** Orchestrator mode re-hits the P5 deadlock; split-first costs a planning session before any work lands.

### D2 — 2026-07-06
- **Decision:** Exclusion-resolution mechanism: relocate-only vs engine-owned
- **Options:** relocate-only (move sidecars to runtime/content/exclusions/, repoint consumers, make exclusionsRoot a real base-path config each check reads) | engine-owned (runtime resolves scope.exclusions via exclusionsRoot and injects into cmd: checks)
- **Chosen:** relocate-only
- **Rationale:** Stays within the epic frozen ring-1 boundary; engine-owned would make scope.exclusions engine-read (a ring-1 contract change the epic out_of_scope forbids, needing a SPEC 1 re-freeze). Relocate-only still delivers a clean liftable pattern (content-ring relocation + config-driven base path) and kills the dangling exclusionsRoot pointer. User confirmed via AskUserQuestion (scope-boundary floor pause).
- **Rejected:** Engine-owned is more abstracted but crosses the epic boundary and re-opens frozen ring-1 contracts.

### D3 — 2026-07-06
- **Decision:** Doc-reference scope for the sidecar relocation
- **Options:** update all LIVE doc references (CLAUDE.md, architecture docs, 7 skills, service card) + functional refs | functional refs only + file live-doc repoint as a follow-up
- **Chosen:** update all LIVE doc references + functional refs
- **Rationale:** Cleanest / no dangling refs (memory: cleanest-over-blast-radius). Leaving CLAUDE.md + create-*/audit-* skills pointing at tools/ would instruct devs to write to a path the checks no longer read. Historical plans/specs/backlog (25 files) stay as point-in-time records; frozen-model arch docs only get a literal path corrected, not a model change. User confirmed via AskUserQuestion (scope-boundary floor pause).
- **Rejected:** Functional-only leaves ~18 live-doc refs actively wrong and defers the completeness the item explicitly targets.
