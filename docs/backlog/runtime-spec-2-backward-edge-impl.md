---
id: runtime-spec-2-backward-edge-impl
status: shipped
closed: 2026-07-01
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
validation_gate: |
  Branch feat/runtime-spec-2-backward-edge-impl, 26 TDD commits (A1 project scaffold d1a553db → F2 README c84154a8).
  runtime:test GREEN (SPEC 1 + SPEC 2 together) + runtime:typecheck clean; 64/64 backward node:test +
  115/115 loose tools node:test (incl. the 24 SPEC-2 drift-gate tests over golden good/bad fixtures).
  The moat proven end-to-end: 5-lesson dogfood mint→ratify→register→land-eval, sync-supersede + async-retire
  (driven by SPEC 1 metaCheck dangling-scope) proofs, and content-ring bidirectional mints:↔check reconciliation.
  Content ring materialized BY the mint procedure itself (5 checks + 5 eval scenarios + 5 reconciled lessons;
  loadRegistry 11 checks / 0 errors). Tier-0 no-deploy (detect-deploy exit 10); derivation=false. Complex lane,
  own PR via finishing-a-development-branch.
topic_memory: []
notes: "Slice 2 of runtime-realization — the backward edge / learning loop (the MOAT): mint + curate at the floor, provenance/supersession chains, enforcement-as-memory (mints:), eval-scenario landing; dogfooded FIRST on the 5 real mechanizable feedback_* lessons (no_scan_no_filter, no_silent_fallback_in_agent_results, no_seeder_fixtures, prefer_libraries_over_casts, states_runtime_uncatchable). Its plan MUST be authored INLINE at MAX effort against SPEC 1's MERGED contract (status/provenance/FlakeContract/advanceLifecycle), not the paper schema. Parking trigger cleared 2026-07-01 — SPEC 1 (runtime-spec-1-check-registry-impl) shipped, unblocking this slice; now active as the next runtime-realization vertical slice."
---

# SPEC 2 — the backward edge / learning loop (the moat) — build

Slice 2 of `runtime-realization`. Builds the differentiator: a shipped fix minting a permanent,
floor-ratified check, and curating obsolete guards — proven first on five real, mechanizable
`feedback_*` lessons. Built against the merged SPEC 1 registry contract (slice 1, shipped 2026-07-01).
See the epic `runtime-realization` for the method and sequence.

## Shipped 2026-07-01

The ring-1 backward edge (`runtime/engine/backward/`), TDD, all against SPEC 1's **merged** contract:

- **5 zod schemas** (`schema/`) — `mints-entry`, `candidate-draft` (leaves `provenance.ratified` UNSET —
  ratification happens only at the floor), `floor-choice`, `floor-decision`, `eval-landing`.
- **6 helpers + 2 orchestrators** (`lib/`) — `capabilities` (injected `ask`/`journal` seams, headless-safe;
  never self-ratifies), `present-floor`, `draft-candidate`, `land-eval-scenario`, `reconcile-lesson`,
  `register-ratified` (the atomic journal-keyed ratify unit), `curate-guard` (retire/supersede/**keep**-no-op),
  and `mint`/`curate` (`runMint`/`runCurate`) — both **drive** SPEC 1 `advanceLifecycle`, never re-implement it.
- **5 reusable drift gates** (`tools/check-*.mjs`) over one shared walker (`tools/lib/text-scan.mjs`), each a
  thin `findViolations` predicate + golden good/bad fixtures, minted from real `feedback_*` lessons.
- **Dogfood** — `dogfood/lessons.mjs` (the 5-lesson table) + `materialize.mjs` emit the content ring
  (`content/checks/*.yaml`, `eval/scenarios/`, reconciled `content/lessons/*.md`) **via the mint procedure itself**.

**Merged-contract deltas honored:** Δ1 `run: "cmd:node …"`; Δ2 candidate leaves `ratified` unset; Δ3 `keep`
is a procedure no-op (never routed to `advanceLifecycle`); Δ4 FlakeContract requires calibration; Δ5
`advanceLifecycle` signature/returns. One plan-regex bug caught by TDD (D3 `.put(` lookbehind rejected
`doc.put({`) and one test-determinism fix (dogfood ratify seeds the pre-mint lesson state, independent of
the materialized ring — `reconcileLesson` correctly keeps first-ratified-wins).

SPEC 3 (forward edge + real capability seams) is the next `runtime-realization` slice; it binds real
`ask`/`journal` and consumes these procedures unchanged.
