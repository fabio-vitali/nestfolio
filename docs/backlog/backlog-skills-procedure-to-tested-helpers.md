---
id: backlog-skills-procedure-to-tested-helpers
status: shipped
closed: 2026-06-29
type: refactor
notes: "γ pass: push load-bearing multi-step bash procedures (worktree cleanup, PR conflict resolution, resume gate) out of SKILL.md prose into tested .mjs helpers. Higher value/risk — needs its own brainstorm."
references:
  - docs/superpowers/specs/2026-06-29-backlog-skills-procedure-to-tested-helpers-design.md
out_of_scope:
  - "Swapping any external CLI for a library (gh→Octokit, deploy.sh→AWS SDK). The compare-observability constraint requires γ helpers to keep the external boundary at the stubbed CLI binary so the benchmark PATH-shims stay observable. Library swaps would make a shim go silent (false RED / vacuous false GREEN)."
  - "Adding new benchmark-harness shims in scripts/benchmark-backlog/stubs/ — only needed if a library swap were unavoidable, which it is not for this member."
  - "Behavioral changes to the procedures. This is a behavior-preserving refactor: characterization tests pin CURRENT behavior before extraction, and each helper must reproduce the F-scenario the prose currently guards."
  - "Skills outside the backlog suite (only backlog-next + backlog-next-epic carry these load-bearing bash dances)."
  - "The β LESSONS.md extraction (already shipped as backlog-skills-lessons-extraction)."
  - "Running the full /benchmark-backlog compare/eval gate — that is the epic's validation method run once at epic close, not this member's deliverable."
spec: docs/superpowers/specs/2026-06-29-backlog-skills-procedure-to-tested-helpers-design.md
plan: docs/superpowers/plans/2026-06-29-backlog-skills-procedure-to-tested-helpers.md
topic_memory: []
validation_gate: "3 tested .mjs helpers extracted (resume-gate.mjs, worktree-ops.mjs, pr-conflict-resolve.mjs) + SKILL.md prose wired in both backlog-next + backlog-next-epic @ d71936e3. Tests GREEN: backlog-next-epic 49/49 (19 new chars-tests: resume 7 + worktree-ops 7 + pr-conflict 5), backlog-next 40/40 (unchanged), backlog-lint 11/11. Closing detectors no-op (skills-only, Tier 0): doc-derivation=false, deploy=false, 0 affected nx projects. Compare-observability preserved: helpers shell out ONLY to git + node lint.mjs (run-for-real/end-state-graded); gh/deploy.sh/nx/backlog-next-worker untouched in prose. LEAVE items (phantom self-heal, post-merge-tail sequencing) kept as prose per design §3. Epic-batched e2e at epic close."
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
