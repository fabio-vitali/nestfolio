---
id: backlog-eval-framework-full-corpus
status: parking
type: tooling
notes: "Phase 6 of backlog-eval-framework: the /benchmark-backlog skill surface + the full ~50-scenario corpus (per-skill coverage enumerated in the spec). Builds on the proven core (PR #24) and the backlog-eval-framework-usable milestone."
references:
  - docs/superpowers/specs/2026-06-24-backlog-eval-framework-design.md
  - docs/superpowers/plans/2026-06-24-backlog-eval-framework.md
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
validation_gate: null
epic: backlog-eval-framework-remaining
epic_role: core
---

# backlog-eval-framework — full corpus + skill surface (Phase 6)

The core harness (PR #24) ships with 6 exemplar scenarios. Phase 6 scales it to the full coverage the
spec enumerates:

- **`/benchmark-backlog` skill** (`disable-model-invocation`, user-triggered): `regression | compare
  <refA> <refB> | rebaseline` modes, cost-conscious gating, and a hook that also runs the existing
  `node --test .claude/skills/backlog-*/test/*.test.mjs` deterministic suites so one invocation reports
  the whole system.
- **Full ~50-scenario corpus** (spec §"Scenario corpus"): `backlog-next-epic` ≈35 (resume gate,
  selection, rule-11/promote, `--auto` decisions, member-loop/F-21/debug-budget, ship/captured audit,
  E6 false-green, merge-ownership, merge-conflict + sub-gaps), `backlog-add` ≈9, `backlog-next` ≈6,
  `backlog-themes` ≈2. Each authored from the proven exemplar template, outcomes-only, passing
  `structural-lint`, with `rubricGate` on the judgment-heavy ones.
- **Full baseline** on `main` over the whole corpus.

Note the per-opus-run cost (`backlog-next-epic` ≈ $5–8 each) — a full 3-iteration corpus baseline is a
deliberate, budgeted spend. Builds on backlog-eval-framework-usable (the gate/baseline/teeth
hardening) being done first.
