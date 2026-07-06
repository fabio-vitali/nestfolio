---
id: runtime-check-exclusions-content-ring
status: active
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
validation_gate: null
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
