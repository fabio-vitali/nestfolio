---
id: bne-resume-absent-fresh-unreachable-memberloop
status: active
type: tooling
notes: "bne-resume-absent-fresh asserts memberLoopEntered:false via subskill denials, but the orchestrator circumvents Skill() denies via raw Bash and drives the fresh run to PR — same root cause as bne-promote-clean."
references: []
out_of_scope:
  - "The other memberLoopEntered:false scenarios that gate via RELIABLE stop mechanisms (not circumventable denials) — bne-resume-pr-open-stop / bne-resume-corrupt-stop / bne-resume-merged-tail-only (resume gate stops before the loop), bne-select-* (selection-confirm AskUserQuestion pause), bne-rule11-different-active (rule-11 guard stop). They gate fine; do NOT touch them."
  - "bne-resume-partial (tracked separately by bef-resume-partial-scenario-flaky, already shipped) — not re-opened here."
  - "The production backlog-next-epic skill text / resume-gate behavior — the orchestrator's Skill-deny-circumvention is correct, DESIGNED behavior; this member fixes only the eval scenario's assertion, never the skill."
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
validation_gate: null
epic: backlog-eval-corpus-hardening
epic_role: core
---

# bne-resume-absent-fresh asserts unreachable memberLoopEntered via denials

Surfaced while fixing `bne-promote-clean` (member `bef-baseline-surfaced-scenario-failures`,
2026-06-28). `scripts/benchmark-backlog/scenarios/bne-resume-absent-fresh.scenario.mjs` asserts
`state.memberLoopEntered: false` and relies on `denySubskills: ['Skill(backlog-next)', ...]` to stop
the run after the resume-gate's "absent run-state → fresh run" promote. But the epic orchestrator
**circumvents `Skill()` denials** — it Read-s the stub worker SKILL.md and Bash-runs `worker.mjs`
directly, runs `gh pr create` itself, and drives the fresh run all the way to PR-open. So
`backlog-next-worker` lands in the stub log → `memberLoopEntered` is **true**, and the scenario
cannot gate deterministically. Proven for the identical-pattern `bne-promote-clean` (its transcript
reached PR #1 with `backlog-next` denied; 0/3 on `memberLoopEntered:false`).

**Fix pattern (same as the shipped bne-promote-clean fix):**
- Drop `denySubskills` + the `memberLoopEntered: false` assertion.
- Assert the fresh-run promote outcome instead — `originMainContains: 'promote'` + the epic
  frontmatter (active + done_when/scope/out_of_scope on the root) — which is what the resume-gate
  "absent → fresh" test actually exists to verify.
- Add `timeoutMs: 900000` (the full 2-member parking-epic run is ~50 turns and brushes the 600s
  default — the same heaviness that forced the override on `bne-promote-clean`).

**Scope (audited, do NOT touch these):** the other `memberLoopEntered: false` scenarios stop via
**reliable** mechanisms, not circumventable denials, so they gate fine —
`bne-resume-pr-open-stop` / `bne-resume-corrupt-stop` / `bne-resume-merged-tail-only` (the resume
gate stops before the loop), `bne-select-*` (the selection-confirm `AskUserQuestion` pause), and
`bne-rule11-different-active` (the rule-11 guard stop). `bne-resume-partial` is tracked separately by
[[bef-resume-partial-scenario-flaky]] (member 3/3) — its `memberLoopEntered:false` + denials may be
the same root cause behind its rubric flake, to confirm there.

Core member: leaving it broken means the full-corpus baseline has a RED scenario, falsifying the
epic `done_when` clause "every scenario gates deterministically." Topic:
[[project_backlog_eval_framework]].
