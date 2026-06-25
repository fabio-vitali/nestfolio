---
id: backlog-eval-framework-baseline-run
status: parking
type: tooling
notes: "Run the full 3-iteration baseline over the 52-scenario corpus via `/benchmark-backlog rebaseline` to establish the regression reference for backlog-skills-simplification. Deferred Task 17 of the backlog-eval-framework plan — split out of backlog-eval-framework-full-corpus per the 2026-06-25 cost-floor decision (a single full-corpus run is ~tens of millions of tokens; each backlog-next-epic scenario ≈1.7–3M). Cost-gated: run only when the budget is being deliberately spent, before backlog-skills-simplification starts."
references: []
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
validation_gate: null
---

# backlog-eval-framework — full-corpus baseline run (deferred Task 17)

The skill + the full 52-scenario corpus shipped in `backlog-eval-framework-full-corpus` (committed,
deterministic gate green: structural-lint + fixture-existence + 54 harness unit tests). What was
deliberately **deferred** is the live, budgeted run:

- `node scripts/benchmark-backlog/run.mjs rebaseline --iterations=3 > scripts/benchmark-backlog/baseline.json`
  (or `/benchmark-backlog rebaseline`) — runs every scenario live N×, overwriting the committed
  exemplar baseline with the full-corpus baseline.

This is the cost-floor item: ~tens of millions of subscription-quota tokens for one full pass
(driven by the ~35 `backlog-next-epic` scenarios at ≈1.7–3M tokens each). It is **not** required for
the corpus to exist (the `backlog-eval-framework-remaining` epic's `done_when` is the corpus + skill
surface), but it **is** the regression reference `backlog-skills-simplification` will diff against,
so it should run — as a deliberate, user-triggered spend — before that consumer epic begins.

Running it also serves as the live validation of the 52 scenarios: any scenario authored
structurally-sound-but-not-live-proven surfaces here (debug via `superpowers:systematic-debugging`;
the scenario/harness is the bug, never lower the bar).
