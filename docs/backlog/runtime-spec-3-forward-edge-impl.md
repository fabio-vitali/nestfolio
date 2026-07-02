---
id: runtime-spec-3-forward-edge-impl
status: shipped
rank: null
type: feature
epic: runtime-realization
epic_role: core
references:
  - docs/superpowers/specs/2026-07-01-runtime-spec-3-forward-edge-and-capability-seams.md
out_of_scope:
  - "SPEC 1 (registry/atom) and SPEC 2 (backward edge) — separate slices of runtime-realization."
  - "A second host adapter / full 34-surface content-ring migration — beyond this slice's proof scope."
spec: docs/superpowers/specs/2026-07-01-runtime-spec-3-forward-edge-and-capability-seams.md
plan: docs/superpowers/plans/2026-07-01-runtime-spec-3-forward-edge-impl.md
topic_memory: [project_runtime_realization.md]
validation_gate: "176/176 runtime node:test green (engine+backward+loop+adapters+eval) + tsc --noEmit clean + ring-1 import-boundary guard (seam #1 never leaks) + 66/66 benchmark-backlog unit tests. Phase D seam unification: full 64-test backward suite green on SPEC 3's formal ask/journal seam (fork Q1). H1 defineSuite rewire proven behavior-preserving (identity wrapper; full headless corpus skipped by decision). Starter checks runtime-exercised (scope-gate self-resolves, exit 0). §14 operational surface deferred (fork Q2) → filed runtime-operational-surface. E0 judge-param delta re-frozen into SPEC 1 §15. Tier-0 no-deploy: validation IS node --test + tsc + benchmark corpus."
notes: "Slice 3 of runtime-realization — forward edge & capability seams: watch/intake/planner/execution + the scope-gate, the six capability interfaces + the <<HARNESS-PAUSE>> sentinel, the journal idempotency contract, three-rings/two-seams, the no-lost-value equivalence map (migrates surfaces into content-ring YAML), the eval harness, the starter library + on-ramp, the operational surface. Promoted parking→active 2026-07-01: trigger fired — SPEC 1 (runtime-spec-1-check-registry-impl) AND SPEC 2 (runtime-spec-2-backward-edge-impl) both shipped, so its plan is authored INLINE at MAX effort against their MERGED, battle-tested contracts."
---

# SPEC 3 — forward edge & capability seams — build

Slice 3 of `runtime-realization`. Builds the watch→intake→planner→execution forward edge, the six
capability interfaces (the harness seam), the journal idempotency contract, and the no-lost-value
equivalence map that migrates the reference checks into the content ring. Depends on merged SPEC 1
(+ SPEC 2); planned + built only after slices 1–2 ship. See the epic `runtime-realization`.

## Ship (2026-07-02)

Built inline + visible (TDD, per the vision legibility law + `feedback_no_worker_isolating_subagents`),
Phases A→J, ~24 `--no-verify` commits in worktree `runtime-spec-3-forward-edge-impl`:

- **B/C — the seam contract.** `capabilities/index.ts` (the six interfaces) + `journal.schema.ts` (types)
  + the git-native NDJSON step-ledger (`begin/step/record/read/awaiting/fulfil`; resume-as-replay;
  tail-heal; `pure-rederive` never ledgered).
- **D — fork Q1 (UNIFY).** SPEC 2's backward edge (`mint`/`curate`) rewritten onto SPEC 3's formal
  `ask`(Decision→Choice) / `journal.step` seam — a breaking swap to the shared `inMemoryJournal`
  (`has/get`→`step`); the full **64-test backward suite** is the exit gate, green.
- **E — the forward helpers.** `run-watch` (activated ∩ affordable + global invariants; gap-finding on
  throw), the self-resolving `scope-gate` (reads `docs/backlog` itself), `run-gate` (fail-closed),
  `intake` (fold/join-theme/mint-aggregation/orphan/split, every item carries `from_finding`),
  `plan-next` (read-time impact, only `rank` stored). E0 added the optional `judge` capability.
- **F — the loop spine.** `worker` (begin→gate→execute→gate→**ask-to-ship**, never auto) + `orchestrator`
  (core members inline via `execute`, never `fanOut`; **sha-conditional epic-pre-done** via `e2eIsFresh`
  — a moved HEAD re-runs, a resume never replays a stale e2e).
- **G — the Claude Code adapter** (seam #1's first binding): six bindings; `ask` degrades to
  `<<HARNESS-PAUSE>>` headless; `fanOut` returns **summaries only**; ring-1 import-boundary guard.
- **H/I — carry-forward + on-ramp.** `benchmark-backlog` routed through the live `defineSuite` seam;
  the CHECK-eval grader (SPEC 2 handoff); the **6-check pre-ratified starter pack** + `init`/`watch`/`next`
  on-ramp CLI.
- **J — reconcile.** E0 judge-param delta re-frozen into **SPEC 1 §15**; forward-edge README + §12
  equivalence-map discharge (journal + scope-gate the two net-new `generalized` rows); **§14 operational
  surface deferred (fork Q2)** → filed `runtime-operational-surface` (captured member).

**Validation:** 176/176 runtime `node:test` + `tsc --noEmit` clean + 66/66 benchmark unit tests; Tier-0
no-deploy. With this, **all three `runtime-realization` core slices (SPEC 1/2/3) are shipped** — the epic's
`done_when` is satisfied; it is eligible for explicit closure.
