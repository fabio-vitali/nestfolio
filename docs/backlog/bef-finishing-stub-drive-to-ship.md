---
id: bef-finishing-stub-drive-to-ship
status: shipped
closed: 2026-06-27
type: tooling
notes: "Stub finishing-a-development-branch in the bef sandbox so drive-to-ship workers route to it instead of reimplementing the merge (the self-merge anti-pattern), enabling a faithful no-self-merge gate."
references: []
out_of_scope:
  - "Fixing the other 3 baseline-surfaced scenario failures (add-mint-aggregation, bne-promote-clean, bne-e6-zero-tests-red) — separate member bef-baseline-surfaced-scenario-failures. (bne-ship-clean IS unblocked by this stub, but its live confirmation is that member's gate.)"
  - "The full-corpus baseline rebaseline — epic-closure step (E6), run once conclusively after all members gate green."
  - "De-flaking the resume scenario — separate member bef-resume-partial-scenario-flaky."
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
validation_gate: "Added stubs/finishing/SKILL.md (open PR via gh stub, NEVER self-merge, pause) + sandbox.mjs staging rule (stub present iff scenario does NOT deny finishing; bne-e8-conflict's real-skill setup hook still overrides). Updated next-lane-complex-ship to the faithful PR-pause shape. Harness suite 60/60 (commits 157c7a19 + 31066c61; adds sandbox staging test: stub present iff not denied). Live verify `regression --scenario=next-lane-complex-ship --iterations=1`: gatePassRate=1, anyGateFlip=false — terminalOk + deploy.sh + gh pr create CALLED + gh pr merge NEVER called + branchCreated (3.03M tokens, 30 turns). First live run exposed a sandbox-root-golden mismatch (Complex-lane ships on the unmerged sub-worktree branch; gradeGolden reads sandbox root) → fixed by asserting branchCreated (31066c61). Definitive corpus-wide green at the epic E6 full baseline. Also unblocks bne-ship-clean (same root cause; its confirmation is bef-baseline-surfaced-scenario-failures' gate)."
epic: backlog-eval-corpus-hardening
epic_role: core
---

# Stub finishing-a-development-branch for faithful drive-to-ship gating

`scripts/benchmark-backlog/sandbox.mjs` copies the 5 backlog skills + `backlog-lint` but NOT
`superpowers:finishing-a-development-branch`. So when the new `next-lane-complex-ship` scenario's
worker reaches `/backlog-next` Step 6.7 ("route to finishing-a-development-branch — do NOT merge
manually"), the skill is absent and the worker **reimplements the finish manually** — the exact
documented anti-pattern. Live runs 2026-06-26 showed this is nondeterministic: one run did a local
`--no-ff` merge + push, another did `gh pr create` + `gh pr merge --squash --delete-branch` (a
self-merge). So `next-lane-complex-ship` cannot deterministically assert `neverCalled: ['gh pr merge']`
and currently drops the no-self-merge assertion (keeps deploy.sh-fired + shipped + on-origin-main).

**Fix:** add a deterministic `stubs/finishing/SKILL.md` (mirroring `stubs/backlog-next/SKILL.md`)
that does the sanctioned finish — open a PR via the `gh` stub, NEVER self-merge, return/pause — and
copy it into the sandbox for `skill: 'backlog-next'` scenarios (analogous to how the backlog-next
worker stub overrides for epic scenarios). Then `next-lane-complex-ship` (or a sibling) can faithfully
assert `callLog: { called: ['gh pr create'], neverCalled: ['gh pr merge'] }` + `terminal: 'pause'`,
mirroring the epic `bne-ship-clean` shape. This also unlocks the full PR→merge→cleanup tail that the
current scenario deliberately defers.

Found during the backlog-eval-framework review rec-1 implementation. Topic:
[[project_backlog_eval_framework]]. Affinity: `backlog-eval-framework-baseline-run`,
`bef-resume-partial-scenario-flaky` (all eval-corpus validation/hardening — candidates for a
`/backlog-themes` cluster).
