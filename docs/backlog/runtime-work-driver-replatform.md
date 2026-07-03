---
id: runtime-work-driver-replatform
status: parking
type: refactor
epic: runtime-operationalization
epic_role: core
notes: "P5 strangler: re-platform the backlog skills onto the engine one at a time (lint→registry gates, add→intake router, next→worker spine, next-epic→orchestrator) with the legacy body retained behind a flag; soak gate = ≥5 real workstreams driven by the runtime loop, zero legacy fallbacks, parity oracle green. Legacy retirement is user-triggered at the end."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Work-driver re-platform — the strangler migration off the backlog skills

The epic's `done_when` claims the runtime becomes the project's **work-driver**, not only its enforcement.
This member delivers that claim via a strangler-fig migration — the legacy system stays intact and
authoritative until a soak gate passes, so the migration is reversible at every step.

**Architectural fact that de-risks this:** there is NO data migration. `docs/backlog/*.md` remains the one
item store; the runtime reads it directly (validated after `runtime-item-schema-reconciliation`). Only
*procedures* move. Rollback at any point = stop calling the runtime path.

**Deliverables (one skill at a time, each individually revertable):**

1. `backlog-lint` → the registry: the 11 rules run as individual `CheckEntry` gates via `run-gate`/
   `run-watch` (lands with `runtime-check-migration-completion`); `lint.mjs --fix` regeneration stays.
2. `backlog-add` → `intake.mjs`: the epic-aware router re-platformed onto the engine's intake, findings →
   items through one code path.
3. `/backlog-next` → the worker spine: lanes/preflight/postflight run through `runWorker` + live
   capabilities (builds on the `runtime-seam-probe` result + its re-frozen contract deltas).
4. `/backlog-next-epic` → `runOrchestrator`: core members inline, sha-conditional epic-pre-done batch.
5. Each re-platformed skill keeps its **legacy body behind a flag** until the soak gate passes
   (no-cleanup-during-migration rule: the old suite stays green throughout).

**Soak gate (binding, before any legacy deletion):** ≥5 real workstreams driven end-to-end by the runtime
loop with ZERO legacy fallbacks, AND the parity oracle (`runtime-regression-harness`) green — same
scenarios, runtime ≥ legacy. Legacy-path deletion is a separate, user-triggered act (P6), never bundled.

Roadmap: P5 of the probes-first adoption plan (see epic body). Depends on: `runtime-seam-probe`,
`runtime-backward-edge-live`, `runtime-item-schema-reconciliation`, `runtime-regression-harness`.
