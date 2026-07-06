---
id: runtime-check-exclusions-content-ring
status: parking
type: refactor
epic: runtime-operationalization
epic_role: core
notes: "Split from runtime-check-migration-completion 2026-07-06. Relocate the 8 tools/*-exclusions.json sidecars under runtime/content/exclusions/ and make the dangling exclusionsRoot config pointer real. Today: sidecars read by each check-*.mjs via hardcoded tools/ paths; also referenced by runtime/engine/backward/dogfood/lessons.mjs (2), nx inputs in libs/event-processor/project.json (3), and test fixtures; scope.exclusions is metadata-only (runtime never reads it); exclusionsRoot is declared but unread. Mechanism choice (relocate-only vs engine-owned resolution) is this item's own design call. Orthogonal to 'checks run on a cadence' — the migrated checks already run correctly with their tools/ sidecars."
references: []
out_of_scope: []
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
