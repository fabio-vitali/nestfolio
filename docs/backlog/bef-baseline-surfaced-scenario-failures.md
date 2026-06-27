---
id: bef-baseline-surfaced-scenario-failures
status: parking
type: bug
notes: "Right-sized live baseline (2026-06-27) found 4 scenarios gate-failing on HEAD: add-mint-aggregation, bne-promote-clean, bne-e6-zero-tests-red, bne-ship-clean. Re-run to confirm consistency, then fix scenario-or-skill so each gates green."
references: []
out_of_scope:
  - "next-lane-doc-layer — its terminal-expectation scenario bug was fixed in the same workstream (scenarios/next-lane-doc-layer.scenario.mjs); flips green on next rebaseline."
  - "bne-resume-partial — already tracked by [[bef-resume-partial-scenario-flaky]]; not re-filed here."
  - "The clean full-corpus rebaseline itself — happens after these gate green (epic closure step)."
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
validation_gate: null
epic: backlog-eval-corpus-hardening
epic_role: core
---

# Live baseline surfaced 4 gate-failing scenarios

Surfaced by the right-sized live baseline run of [[backlog-eval-framework-baseline-run]]
(15 scenarios, `regression --iterations=1`, 2026-06-27). The run itself was clean — 0 crashes,
32.9M tokens — but **6/15 scenarios gate-failed**. Of those: `next-lane-doc-layer` was a scenario
bug fixed in-workstream, and `bne-resume-partial` is already tracked. The **4 remaining** are filed
here as the epic's "every scenario gates deterministically" hardening work.

**⚠ iterations=1** — a single failing run cannot distinguish *consistently broken* from *flaky*.
First step for each is a **confirming re-run** (per [[feedback-flake-means-broken]]); only then decide
scenario-bug (fix the scenario) vs skill-bug (fix the prose). The two `bne-*` orchestrator failures
are the higher-stakes ones — split them out as their own items if a re-run confirms a real
`backlog-next-epic` defect (a broken clean-ship / zero-test-red gate matters before
`backlog-skills-simplification` edits that prose, since there'd be no green happy-path to preserve).

| scenario | rubric | diagnostic | leaning |
|---|---|---|---|
| `add-mint-aggregation` | 5/5 | `terminal=completed, expected pause` — suggested the mint correctly but didn't pause for confirmation | scenario⇄`backlog-add`: should it pause on a mint-suggestion in headless mode? |
| `bne-promote-clean` | 4/5 | `origin/main missing commit "promote"` — promoted but the marker didn't reach origin/main | orchestrator: push-on-promote, or scenario expectation |
| `bne-e6-zero-tests-red` | 1/5 | `forbidden "gh pr create" present` — a zero-collected test run (exit 0, 0 tests) was treated as GREEN and shipped | **orchestrator behavior gap** (E6 zero-test-red guard) |
| `bne-ship-clean` | 2/5 | golden: epic `status` expected `shipped` got `active`, `closed` absent — the clean ship never completed | **orchestrator ship-path** (likely real) |

Diagnostics are from the committed `scripts/benchmark-backlog/baseline.json` rows (each carries a
`diagnostics` block when it failed). Debug via `superpowers:systematic-debugging`; the bar is never
lowered — if the scenario's golden/invariant is wrong, fix the scenario; if the skill is wrong, fix
the prose.
