---
id: backlog-skills-procedure-to-tested-helpers
status: parking
type: refactor
notes: "γ pass: push load-bearing multi-step bash procedures (worktree cleanup, PR conflict resolution, resume gate) out of SKILL.md prose into tested .mjs helpers. Higher value/risk — needs its own brainstorm."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: backlog-skills-simplification
epic_role: core
---

# Backlog skills: procedure → tested helpers (γ)

**The move.** Several backlog skills narrate **load-bearing multi-step bash dances** directly in
SKILL.md prose, where they cannot be unit-tested and are easy to follow wrong:

- the Step-6.8 / E8.2 worktree cleanup (`worktree remove --force` + `branch -d` + `prune` from the
  main root, with the `merge-base --is-ancestor` safety check);
- the E8.1 PR merge-conflict resolution (the `docs/BACKLOG.md`-vs-`<id>.md` two-kinds split, take-
  branch-side + `lint --fix` ordering);
- the resume gate / run-state branching.

Encapsulate each into a **tested `.mjs` helper** — the pattern `epic-members.mjs` and `runstate.mjs`
already establish (pure logic + `node --test` suites) — so the SKILL.md just *calls* the helper and
the correctness lives in tests, not prose.

**Why this is the higher-risk member.** Unlike β (doc-restructuring), γ moves **load-bearing logic**.
A subtle behavioral change here could regress one of the F-bugs the prose currently guards. So:

- **Needs its own brainstorm/investigation before execution** — pick which procedures are worth
  extracting (some bash is genuinely one-shot and not worth a helper), design each helper's interface,
  and write characterization tests that pin *current* behavior before refactoring.
- Each extracted helper must ship with a `node --test` suite covering the F-scenario it preserves.

**Compare-observability constraint (load-bearing — keeps the epic's compare gate honest).** The
`/benchmark-backlog` harness intercepts the external boundary via **PATH-shim binaries** (`gh`, `nx`,
`deploy.sh`, `backlog-next-worker` — `grade.mjs` string-matches `$BEF_STUBS_LOG`); internal git/
worktree/run-state ops are graded by **end-state**, not call-log (`structural-lint.mjs` enforces the
split). So a helper that *shells out* to the stubbed CLI binary (`execSync('gh …')`) stays fully
observable — the call-log assertions fire identically prose-vs-helper. **But a helper that swaps the
CLI for a library** (e.g. Octokit instead of `gh`, the AWS SDK instead of `deploy.sh`) makes the shim
go silent: a `callLog.called:['gh …']` then mis-reads as a regression (false RED) and, worse, a
`neverCalled:['gh pr merge']` passes **vacuously** (false GREEN — "never self-merged" only because we
stopped watching `gh`). **Rule:** γ helpers keep the external boundary at the stubbed CLI binary. If a
library swap is genuinely unavoidable for some op, that op needs a **new shim at its seam** in
`scripts/benchmark-backlog/stubs/` *before* the compare is trustworthy — the one case where γ touches
the harness rather than just the skills. (The PR-merge and deploy dances are the at-risk ones; the
worktree/resume dances use plain `git`, which the harness runs for real and grades by state.)

**Relationship to β.** Do β first (it makes the procedures legible, surfacing exactly which bash
blocks are load-bearing) — but both ship in the **one** `backlog-skills-simplification` branch/PR.

**Cheapest next step.** When this epic is promoted: brainstorm γ specifically — enumerate the
candidate bash blocks, score extract-vs-leave, and define the characterization-test baseline.
