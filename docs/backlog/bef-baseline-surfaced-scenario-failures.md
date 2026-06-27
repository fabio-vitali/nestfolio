---
id: bef-baseline-surfaced-scenario-failures
status: parking
type: bug
notes: "Live baseline found 4 reds. Confirming ×3 re-run (2026-06-27): bne-ship-clean 0/3 consistent (likely the missing finishing stub → bef-finishing-stub-drive-to-ship, not a prose bug); bne-e6-zero-tests-red 2/3 FLAKY (real — 1/3 it ships with zero tests); add-mint-aggregation + bne-promote-clean still unconfirmed (iterations=1)."
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

## Confirming re-run (×3, 2026-06-27) — the 2 `bne-*` orchestrator failures

`regression --scenario=bne-ship-clean,bne-e6-zero-tests-red --iterations=3` (does NOT touch
`baseline.json`). Verdict:

- **`bne-ship-clean` — 0/3, `anyGateFlip:false` → CONSISTENT.** Same golden failure all three runs
  (epic left `active`, never `shipped+closed`; rubric 2/5). **Likely root cause: the sandbox never
  stubs `superpowers:finishing-a-development-branch`** — `sandbox.mjs` copies only `backlog-*` skills,
  so the E8 close step has no finish skill to invoke and the epic can't reach `shipped+closed`. This is
  almost certainly **subsumed by [[bef-finishing-stub-drive-to-ship]]**, NOT a `backlog-next-epic`
  prose defect. **Confirm:** land that stub, then re-run — expect green. (Hypothesis, not yet proven
  from a transcript; the consistency + the sandbox gap make it strong.)
- **`bne-e6-zero-tests-red` — 2/3, `anyGateFlip:true` → GENUINELY FLAKY (real).** The failing
  iteration tripped a *deterministic* call-log invariant (`gh pr create` present) — the orchestrator
  really shipped despite a zero-collected test run, ~1-in-3. Not judge noise, not the finish stub
  (it got as far as PR creation). A real intermittent gap in the E6 zero-collected-as-RED guard —
  per [[feedback-flake-means-broken]] it IS broken, just not every run. Work = de-flake the guard so a
  zero-collected run blocks the ship every time.
- **`add-mint-aggregation`, `bne-promote-clean` — still unconfirmed** (only the single iterations=1
  baseline run). Same confirming `--iterations=3` re-run is the next step before a scenario-vs-skill
  verdict.

**Disposition:** kept as one item (all four are `core` — each falsifies the epic's "every scenario
gates deterministically"). `bne-ship-clean` is cross-linked to the finishing-stub work rather than
split into a new defect; `bne-e6` is the one confirmed *new* orchestrator reliability finding here.
Split either out only if its remediation diverges (e.g. `bne-e6` turns out to need its own focused
de-flake workstream).
