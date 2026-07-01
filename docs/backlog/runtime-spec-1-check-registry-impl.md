---
id: runtime-spec-1-check-registry-impl
status: active
rank: null
type: feature
epic: runtime-realization
epic_role: core
references:
  - docs/superpowers/specs/2026-07-01-runtime-spec-1-check-registry-and-atom.md
  - docs/vision/long-horizon-engineering-runtime.md
out_of_scope:
  - SPEC 2 (the backward edge — mint/curate, floor protocol, enforcement-as-memory) — separate slice of runtime-realization.
  - SPEC 3 (watch engine, intake, planner, execution, the six capability interfaces, journal) — separate slice.
  - Migrating all 34 live check surfaces into registry YAML — this slice builds the ring-1 core + a bounded proof slice of first-content-ring entries; the full migration is a follow-on.
  - Physically relocating `tools/*-exclusions.json` or rewriting `backlog-lint`/`audit-*`/nx drift targets to route through the registry — realization detail, not the core schema+helpers.
  - The capability adapters and the harness seam (SPEC 3, seam #1) — ring-1 core depends outward on nothing.
spec: docs/superpowers/specs/2026-07-01-runtime-spec-1-check-registry-and-atom.md
plan: null
topic_memory: []
notes: "Slice 1 of the runtime-realization epic — build SPEC 1, the check registry & hybrid atom (ring-1 core: check/item/finding schemas, four finding kinds, three contexts, lifecycle state machine, meta-check + rot-detectors, git-native layout + the six typed helpers loadRegistry/resolveEvaluator/runCheck/findByScope/advanceLifecycle/metaCheck). Foundational: freezes the schema SPEC 2 & 3 consume. Phase 1 = re-author the implementation plan INLINE at Opus 4.8 MAX effort (the first plan was written at default effort and DELETED by the user); then execute inline + visible (TDD) on an isolated worktree → own PR. Ring-1 stays project-/harness-agnostic; Nestfolio's live checks are the first content-ring proof slice."
---

# SPEC 1 — Check Registry & the Hybrid Atom (ring-1 core) — build

Slice 1 of the `runtime-realization` epic. Builds the foundational surface of the Runtime: the single
library of checks with provenance and a self-check, plus the hybrid check/item atom. This is the
"single thing to build, test, and port" — everything in SPEC 2 (the backward edge) and SPEC 3
(forward edge + seams) consumes its frozen schema.

**Sequenced first** per the vision (§15) and the vertical-slice decision. **Plan is reset** — the
first implementation plan was authored at default effort and deleted; slice 1 restarts by
re-authoring it **inline at Opus 4.8 max effort**, then executes on the plan's terms. Deliverable of
the build: `runtime/engine/` git-native registry files + the six typed helpers (`loadRegistry` ·
`resolveEvaluator` · `runCheck` · `metaCheck` · `findByScope` · `advanceLifecycle`), their tests
(SPEC 1 §13 given/when/then), and a first-content-ring proof slice mapping a handful of the 34 live
check surfaces onto registry entries. See the epic `runtime-realization` for method and sequence.
