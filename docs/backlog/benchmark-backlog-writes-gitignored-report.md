---
id: benchmark-backlog-writes-gitignored-report
status: shipped
closed: 2026-06-29
type: tooling
notes: "benchmark-backlog run.mjs must write its rendered markdown report (all modes incl. compare) to gitignored benchmarks/backlog/ + print the path; today it only emits rows JSON to stdout."
references: []
out_of_scope:
  - "benchmark-agents — it ALREADY writes evaluation.md + cross-task-report.md under gitignored benchmarks/ (no change needed)."
  - "Changing the grading/rendering logic (gradeScenario, renderEvaluation, renderCompare) — this only adds a file-writing + path-print step around the existing renderers."
  - "Posting reports to PR comments — explicitly NOT the durable home (the trigger for this workstream)."
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
validation_gate: "run.mjs now writes the rendered markdown report (all modes) to gitignored benchmarks/backlog/<mode>-<ISO>.md and prints `[bef] report written: <path>` to stderr; report.mjs grew pure buildReport() (header + table + findings summary) + thin writeReport(); benchmark-backlog SKILL.md Report-back + summary updated to surface the report path first. Tests: scripts/benchmark-backlog harness 64/64 (4 new: buildReport compare-REGRESSION / no-regression / regression-eval + writeReport path+ISO-sanitization). Smoke-verified the integrated buildReport→writeReport lands in gitignored benchmarks/backlog/ (git status clean). benchmark-agents unchanged — already wrote evaluation.md/cross-task-report.md to benchmarks/. Simple lane on main."
---

# benchmark-backlog writes its report to a gitignored file

**Gap (surfaced 2026-06-29 during the backlog-skills-simplification epic compare gate).** `benchmark-backlog`'s
runner (`scripts/benchmark-backlog/run.mjs`) only emits the rows JSON to stdout; the markdown report
(`renderEvaluation` / `renderCompare` in `report.mjs`) is rendered by the agent into chat and never
written to a durable file. The compare results for the epic ended up only in the ephemeral session
scratchpad + a PR comment, which the user could not find. See user-memory [[benchmark-reports-to-gitignored-file]].

**Fix (runner-driven — can't be forgotten).** `run.mjs` writes the rendered report to a gitignored
`benchmarks/backlog/<mode>-<ISO>.md` (the `benchmarks/` folder is already gitignored per the
agent-benchmark design) and prints the absolute path as the last line of the run (to stderr, so stdout
stays the rows JSON the skill captures). `report.mjs` grows a pure `buildReport()` (header + the
existing rendered table + a one-line findings summary) plus a thin `writeReport()`; the
benchmark-backlog SKILL.md "Report back" step is updated to reference the runner-written file + path.

**Sibling parity.** `benchmark-agents` already writes `benchmarks/.../evaluation.md` +
`cross-task-report.md`; this brings `benchmark-backlog` to the same durable-report convention.
