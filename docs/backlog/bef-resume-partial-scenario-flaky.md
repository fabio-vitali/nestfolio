---
id: bef-resume-partial-scenario-flaky
status: shipped
closed: 2026-06-28
type: bug
notes: "bne-resume-partial eval scenario is flaky (rubric 1/5↔4/5, worker flails 35-43 turns on epic resume); rubricGate:4 exposed it."
references: []
out_of_scope:
  - "The other resume scenarios (bne-resume-pr-open-stop / -corrupt-stop / -merged-tail-only) and bne-resume-absent-fresh — they stop via reliable mechanisms (resume gate / selection-confirm) and are tracked separately (member bne-resume-absent-fresh-unreachable-memberloop)."
  - "Changing the grade.mjs harness predicates or the backlog-next-epic resume code itself — this member fixes the SCENARIO's assertions to gate deterministically against existing (callLog) predicates, not the skill under test."
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
validation_gate: "Fix dde2f688: dropped circumventable denySubskills + unreachable/backwards memberLoopEntered:false + flaky rubricGate:4; added deterministic callLog teeth (called: backlog-next-worker beta-3; neverCalled: beta-1/beta-2) proving the resume drove the next OPEN member, never restarting at a shipped one — judge-free, cwd-robust (absolute BEF_STUBS_LOG). Verified: 60/60 harness unit tests (structural-lint validates the new scenario shape) + live `node run.mjs regression --scenario=bne-resume-partial --iterations=3` → gatePassRate=1, anyGateFlip=false, numTurns=38 (was 35-43 flailing under over-denial; rubric had swung 1/5↔4/5). Mirrors the shipped bne-promote-clean pattern."
epic: backlog-eval-corpus-hardening
epic_role: core
---

# bne-resume-partial eval scenario is flaky

`scripts/benchmark-backlog/scenarios/bne-resume-partial.scenario.mjs` does not gate
deterministically. Across two live runs on 2026-06-26 the LLM-judge rubric swung **1/5 → 4/5**,
and the `backlog-next-epic` worker took **35–43 turns** — far more than a clean "resume the active
epic, pick the next OPEN member (beta-3), stop at the member boundary." In the 1/5 run it
mis-resumed; in the 4/5 run it ended pausing about an open PR (`gh pr view`, `<<HARNESS-PAUSE: PR
#1 … awaiting merge>>`), i.e. it wandered into the E8 PR-open path rather than the member loop.

**Surfaced** when review rec 2 added `rubricGate: 4` to this scenario (commit on `main`,
backlog-eval-framework review) — the gate is *correctly* catching the flakiness rather than
passing on the vacuous `memberLoopEntered:false` proxy. So the teeth work; the scenario (or the
skill it exercises) is the problem.

**Two candidate root causes — investigation must disambiguate:**
1. **Scenario over-denial.** `denySubskills: ['Skill(backlog-next)', 'Skill(superpowers:finishing-a-development-branch)', 'Skill(superpowers:using-git-worktrees)']` (now enforced after the rec-3 wiring) may be too aggressive for a *resume*, leaving the orchestrator without tools it needs and forcing it to improvise.
2. **`backlog-next-epic` resume path ambiguity.** The `runstate: { phase: 'mid' }` resume of an already-active epic may be genuinely under-specified, so the worker re-derives members / considers PRs nondeterministically.

**Cheapest next step:** characterize over N≥5 runs (gatePassRate / anyGateFlip via
`node run.mjs regression --scenario=bne-resume-partial --iterations=5`), read the divergent
transcripts, then either tighten the scenario denials/assertions or fix the skill's resume
derivation. Topic: [[project_backlog_eval_framework]]. Affinity: thematically near
`backlog-eval-framework-baseline-run` (both are live-corpus validation/hardening) — a future
`/backlog-themes` sweep may cluster them.
