---
id: backlog-eval-framework-baseline-run
status: shipped
type: tooling
closed: 2026-06-27
notes: "Established a right-sized live regression baseline (15-scenario subset, iterations=1) instead of the full 3× — the corpus measured at 53 scenarios / 35 bne-epic, making a full 3× pass ≈270M tokens (~90% cache-reads of skill prose). The right-sized run validated the harness live (0 crashes, 9✓/6✗, 32.9M tokens) and surfaced 6 gate-failing scenarios; full 3× rebaseline deferred to epic closure after those gate green."
validation_gate: "Right-sized live baseline committed to scripts/benchmark-backlog/baseline.json (15 rows): `node scripts/benchmark-backlog/run.mjs regression --scenario=<15 ids> --iterations=1` → 0 error rows, 0 crashes, 32.9M tokens, gatePass 9/15. Deterministic pre-gate green (backlog-skills suites 135/135, harness 59/59). Live validation surfaced 6 failures: next-lane-doc-layer (scenario bug, fixed in-workstream), bne-resume-partial (already tracked), + 4 routed to bef-baseline-surfaced-scenario-failures. Full-corpus 3× rebaseline deliberately deferred (cost + epic owns 'every scenario gates deterministically')."
out_of_scope:
  - "The backlog-skills-simplification consumer epic itself (the skills-doc restructuring that will diff against this baseline — this item produces the reference, it is not that work)."
  - "Adding or expanding scenarios — this runs the existing 53-scenario corpus, it does not grow coverage."
  - "Fixing the stale benchmark-backlog SKILL.md cost figures (the '6 vs 35 bne scenarios' doc drift surfaced here) — filed separately."
  - "Hardening the sibling epic members (bef-finishing-stub-drive-to-ship, bef-resume-partial-scenario-flaky) — those are their own workstreams."
references: []
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
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

**2026-06-27 — right-sized baseline run + SHIPPED.** On reviewing the smoke's true cost, the *full*
1× corpus measured at ≈90M tokens / 3× ≈270M (~90% cache-reads of skill prose — the inefficiency
`backlog-skills-simplification` exists to reduce; the per-scenario cost *is* the production-fidelity
signal). Chose a **right-sized 15-scenario 1× baseline** (10 distinct heavy `bne` orchestrator paths +
2 add branches + 2 next lanes + themes; ~1/11 of full 3×). Ran via `regression` → scratch → validated
JSON → copied into `baseline.json` (crash-safe, never piping straight into the committed file).

Outcome: **15 rows, 0 crashes, 32.9M tokens, gatePass 9/15.** The live validation did its job —
6 gate failures the deterministic gate (lint + unit suites) could never catch:
- `next-lane-doc-layer` — **scenario-authoring bug**, fixed here (`terminal: 'pause'`→`'completed'`;
  Doc-layer has no downstream skill to deny, so the worker correctly classifies *and completes*).
- `bne-resume-partial` — already tracked by [[bef-resume-partial-scenario-flaky]].
- `add-mint-aggregation`, `bne-promote-clean`, `bne-e6-zero-tests-red`, `bne-ship-clean` — routed to
  [[bef-baseline-surfaced-scenario-failures]] (core member of the epic; needs confirming re-runs).

The committed `baseline.json` is the honest interim reference (9✓/6✗); `regression` protects the 9
green. **Full-corpus 3× rebaseline deferred** to epic closure, after the surfaced failures gate green.
Also filed [[benchmark-backlog-skill-cost-figures-stale]] (the stale "6 bne scenarios" doc figure).
