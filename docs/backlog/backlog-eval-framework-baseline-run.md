---
id: backlog-eval-framework-baseline-run
status: active
type: tooling
notes: "Establish the live regression baseline over the 53-scenario corpus to seed backlog-skills-simplification. Deferred Task 17 of the backlog-eval-framework plan — split out of backlog-eval-framework-full-corpus per the 2026-06-25 cost-floor decision (a single full-corpus run is ~tens of millions of tokens; the 35 backlog-next-epic scenarios drive it at ≈1.7–3M each). Promoted 2026-06-26: the cost-gate trigger fired — the user is deliberately spending the budget before backlog-skills-simplification begins. Running smoke-first (6-scenario live subset, iterations=1) to de-risk the full ~70–100M-token pass before committing to it."
out_of_scope:
  - "The backlog-skills-simplification consumer epic itself (the skills-doc restructuring that will diff against this baseline — this item produces the reference, it is not that work)."
  - "Adding or expanding scenarios — this runs the existing 53-scenario corpus, it does not grow coverage."
  - "Fixing the stale benchmark-backlog SKILL.md cost figures (the '6 vs 35 bne scenarios' doc drift surfaced here) — filed separately."
  - "Hardening the sibling epic members (bef-finishing-stub-drive-to-ship, bef-resume-partial-scenario-flaky) — those are their own workstreams."
references: []
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
validation_gate: null
epic: backlog-eval-corpus-hardening
epic_role: core
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

Running it also serves as the live validation of the 53 scenarios: any scenario authored
structurally-sound-but-not-live-proven surfaces here (debug via `superpowers:systematic-debugging`;
the scenario/harness is the bug, never lower the bar).

## Run log

**2026-06-26 — promoted + smoke-first.** Deterministic pre-gate green (backlog-skills suites 135/135,
harness suites 59/59). Measured the real corpus: **53 scenarios, 35 of them `bne-*` epic** (the
`benchmark-backlog/SKILL.md` "6 bne scenarios" figure is stale — filed separately), so a 1× *full*
pass is ≈70–100M subscription-quota tokens, sequential, hours. Per the cost-conscious de-risk path,
running a **6-scenario live smoke first** — `regression --iterations=1 --scenario=bne-ship-clean,bne-auto-blast-pass,bne-resume-partial,add-fold-core,next-lane-complex,themes-discrimination`
(2 heavy epic ship/auto paths + the resume path + one each of add/next/themes) — to prove the harness
runs live end-to-end and gates before committing to the full-corpus `rebaseline`. The smoke uses
`regression` (not `rebaseline`) so it does **not** overwrite the committed exemplar `baseline.json`.
