---
id: runtime-spec-2-backward-edge-impl
status: active
rank: null
type: feature
epic: runtime-realization
epic_role: core
references:
  - docs/superpowers/specs/2026-07-01-runtime-spec-2-backward-edge-learning-loop.md
out_of_scope:
  - "SPEC 1 (registry/atom) and SPEC 3 (forward edge/seams) — separate slices of runtime-realization."
  - "Generalizing minting beyond the 5-lesson dogfood — prove the lesson→check→eval path first, widen later."
spec: docs/superpowers/specs/2026-07-01-runtime-spec-2-backward-edge-learning-loop.md
plan: docs/superpowers/plans/2026-07-01-runtime-spec-2-backward-edge-impl.md
topic_memory: []
notes: "Slice 2 of runtime-realization — the backward edge / learning loop (the MOAT): mint + curate at the floor, provenance/supersession chains, enforcement-as-memory (mints:), eval-scenario landing; dogfooded FIRST on the 5 real mechanizable feedback_* lessons (no_scan_no_filter, no_silent_fallback_in_agent_results, no_seeder_fixtures, prefer_libraries_over_casts, states_runtime_uncatchable). Its plan MUST be authored INLINE at MAX effort against SPEC 1's MERGED contract (status/provenance/FlakeContract/advanceLifecycle), not the paper schema. Parking trigger cleared 2026-07-01 — SPEC 1 (runtime-spec-1-check-registry-impl) shipped, unblocking this slice; now active as the next runtime-realization vertical slice."
---

# SPEC 2 — the backward edge / learning loop (the moat) — build

Slice 2 of `runtime-realization`. Builds the differentiator: a shipped fix minting a permanent,
floor-ratified check, and curating obsolete guards — proven first on five real, mechanizable
`feedback_*` lessons. Built against the merged SPEC 1 registry contract (slice 1, shipped 2026-07-01).
See the epic `runtime-realization` for the method and sequence.
