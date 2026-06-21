# /backlog-next-epic orchestrator — run an epic as one branch / one PR

**Date:** 2026-06-21
**Status:** approved
**Builds on:** `docs/superpowers/specs/2026-06-16-backlog-epics-design.md` (the epic *model* —
frontmatter, the 11 lint rules, core/captured, close ritual). This spec adds an *orchestration*
layer on top of that model and changes **no** model rule.

## Problem

`/backlog-next` is both a **member worker** and an **epic dispatcher** (Step 1a). Epic dispatch
advances one member per invocation — a human re-runs `/backlog-next <epic-id>` per member, each
member merges to `main` independently, and the expensive real-LLM e2e (full Jest e2e suite,
Playwright) runs *nowhere* because the per-workstream gate forbids it. There is no way to launch
an epic, let it run, and review the whole thing as one PR.

## Goals

1. **Separate orchestration from execution** — `/backlog-next` becomes a pure worker;
   `/backlog-next-epic` owns epic lifecycle.
2. **One branch / one PR per epic** — all members commit to one `feat/epic-<id>` branch; `main`
   moves once, when the validated epic merges.
3. **Batch the expensive e2e at epic pre-done** — keep cheap mocked integration tests per-member
   (localizes regressions); run the costly real-LLM e2e once against the cumulative branch state.
4. **Optional `--auto`** — fire-and-forget: auto-resolve decisions (pick the project-recommended
   = most reusable option, log each for PR review) with a small irreversibility/ambiguity floor
   that still pauses.

## Non-goals (out of scope)

- Any change to the epic model / frontmatter / the 11 lint invariants (frozen 2026-06-16).
- Parallel member execution (members run sequentially — deterministic, no shared-state hazard).
- Nested epics; >1 concurrent delivery epic (rule 11 stays).
- Unattended CI/cron autonomy — `--auto` runs in-session, resumable via a run-state file.

## Design

### A. `/backlog-next` → pure worker

Remove from `.claude/skills/backlog-next/SKILL.md`:
- **Step 1a** (epic dispatch) and the two epic-detection entry checks (default pick + named-id).

Add:
- **Redirect.** A `type: epic` id prints "epics are orchestrated by `/backlog-next-epic` — run
  `/backlog-next-epic <id>`" and stops.
- **Epic-member execution mode** (the orchestrator invokes the worker with the member id + an
  in-epic context signal). In this mode the worker:
  - works **inside the already-active epic worktree** (skip `EnterWorktree`),
  - flips the member `status: active` → `shipped` and **commits to the epic branch**,
  - runs per-member **integration** tests + doc-derivation (6.1) + true-affected test/lint (6.2)
    + per-member deploy if `detect-deploy-needed.mjs` says so (6.3/6.4),
  - **skips** the expensive e2e block, `finishing-a-development-branch` (6.7), worktree cleanup
    (6.8), and any push to `main`,
  - runs the lighter `--lane=epic-member` pre/postflight (§C).

This is an execution-context modifier, **not** epic structure knowledge — the worker still knows
nothing about members, `done_when`, or rule 11. Those live only in the orchestrator.

### B. `/backlog-next-epic <epic-id> [--auto]` (new skill)

`disable-model-invocation: true` (user-triggered only), mirroring `backlog-next`.

**Epic-start (once):**
1. Full preflight (`preflight.mjs`, standard lane): tree clean, `main` == `origin/main`,
   `backlog-lint` green, no stale worktrees.
2. Rule-11 guard (no other active epic) + promote epic `status: active`, ensure
   `done_when:`/`scope:`/`out_of_scope:` present (rule 4). Commit a **minimal promotion marker
   on `main`** (docs-backlog-on-main convention; gives crash-recovery visibility of the in-flight
   epic + its branch name). `backlog-lint --fix`, commit index.
3. One epic worktree + branch `feat/epic-<id>` from `origin/main` (rebase-on-main at start to
   bound drift).
4. Init a **run-state file** `<git-common-dir>/backlog-next-epic-<id>.json` (core members +
   per-member status + decision log) → re-invoking `/backlog-next-epic <id>` resumes.

**Member loop** (core members only; resume `active` first, else top-`rank` queued, else first
`parking` alphabetical; skip `captured` — selection is the tested `epic-members.mjs`
`selectNextMember()`):
- Invoke `/backlog-next <member-id>` in **epic-member mode**.
- After each member: per-member integration tests green; member committed on branch; run-state
  updated.
- **Decisions:**
  - default: a brainstorming/architectural fork → **pause** (AskUserQuestion), then resume.
  - `--auto`: do **not** pause for normal forks → pick the option the project marks
    **(Recommended)** = the most reusable/generalizable (CLAUDE.md hard constraint); append
    `{decision, chosen, rationale, rejected}` to the decision log. **Hard floor still pauses**
    for irreversible/outward-facing actions and any fork with no defensible recommended option.

**Epic pre-done** (all core members terminal):
1. Deploy the cumulative branch state to dev (`deploy.sh sandbox --prefix=dev`).
2. **Batched expensive e2e (the new gate):** scoped Jest e2e across all flows the epic touched
   (`pnpm nx run e2e-feature-tests:test-e2e-features`) **and** the touched Playwright journeys
   (`pnpm nx run nestfolio-e2e:e2e`). Repeat count chosen at epic-start; surfaced via
   AskUserQuestion when ≥ the cost-conscious threshold (`feedback_e2e_cost_conscious`).
3. **Captured audit** (re-test each open captured member vs `done_when`; promote load-bearing
   ones to core), then verify rule 9.
4. Epic ship: epic `status: shipped`, `validation_gate:` = batched-e2e evidence + branch SHA.
5. **One PR** via `superpowers:finishing-a-development-branch` (PR body = decision log +
   per-member commit summary). After merge: worktree/branch cleanup from main root (reuse the
   Step 6.8 git recipe) + epic-level postflight (standard `complex` lane: on `main`, synced,
   branch deleted, no stale worktrees) + `backlog-lint --fix` + boundary review **once**.

### C. Gate-script `epic-member` lane

- `postflight.mjs`: add `epic-member` to the valid lanes; the existing complex-only block stays
  gated on `lane === 'complex'`, so `epic-member` runs only checks 1–3 (tree-clean, lint,
  shipped-frontmatter) — the member stays on the branch; merge/sync/branch-delete checks belong
  to the epic-level close.
- `preflight.mjs`: accept `--lane`; for `epic-member` skip the on-main / main-ahead /
  stale-worktree checks and the snapshot+daemon side-effects (the worker runs inside the epic
  worktree on the branch); keep tree-clean + `backlog-lint`.
- Both refactor their body behind a `main()` guarded by `import.meta.url`/`process.argv[1]`
  (mirroring `detect-deploy-needed.mjs`) so the pure lane predicates are unit-testable on import.

### D. Member selection helper

`.claude/skills/backlog-next-epic/epic-members.mjs` — exports `parseFrontmatter`, `coreMembers`,
`selectNextMember`, `isDrainable`; `main()` prints the next member + roster for an epic id
(replacing the inline bash from old Step 1a). Tested in `test/epic-members.test.mjs`.

## Decisions & alternatives rejected

| Decision | Choice | Rejected |
|----------|--------|----------|
| Member integration vs orchestration | two skills (worker + orchestrator) | keep epic logic inside `/backlog-next` (two jobs, no e2e gate, no one-PR path) |
| Branch granularity | one branch/PR per epic | per-member branch/PR (incremental main churn, no cumulative e2e gate, N PRs to review) |
| Expensive e2e | batched at epic pre-done; per-member integration localizes | per-member expensive e2e (cost ×N) **or** batch all validation (loses fault isolation) |
| Autonomy | default pause-on-decision; `--auto` opt-in with hard floor + decision log | always-pause (no fire-and-forget) **or** never-pause (delegates dangerous/ambiguous forks) |
| `--auto` recommended-pick rule | most reusable/generalizable (CLAUDE.md constraint) | first-listed / fastest option |
| Epic-member gate variant | reuse `preflight`/`postflight` with a lane flag | a separate gate script (duplicate logic) |

## Post-review refinements (2026-06-21 ultracode review)

An adversarial multi-agent review (56 agents) surfaced 5 majors + should-fixes, all folded in before merge:

1. **Resume gate (major #1).** A `Resume gate` runs before E0: if the run-state file exists, skip E1/E3, run E2 idempotently (worktree/branch existence guards), and jump to E4. E3 is fresh-run-only and never overwrites the accumulated decision log.
2. **One-PR invariant (major #2).** `executing-plans`/`subagent-driven-development` end with an unconditional `finishing-a-development-branch` handoff. The worker's Step 5 epic-member delta now **drives only their task-execution phase and STOPS before that handoff**, returning control to the orchestrator (E8 owns the single merge/PR).
3. **E6 failure path (major #3).** A hard batched-e2e failure routes to `systematic-debugging` → re-open the regressing member (back to E6) or file a `queued` epic member (back to E4). E7 ship now requires BOTH rule-9 (exit 10) **and** green batched e2e — exit 10 is necessary, not sufficient.
4. **`--auto` sub-skill taxonomy (major #4).** Decisions are raised *inside* sub-skills, which `--auto` cannot blindly intercept, so E5 enumerates handling: `type: design` members **always pause** (brainstorming's approval gate is never self-approved); `finishing`'s menu → auto Option 2 (Push+PR); other in-member forks → reusable-recommended pick + log; **catch-all → any unenumerated prompt is treated as floor (pause)**. The floor stays advisory but is backed by the harness/CLAUDE.md confirmation layer.
5. **Picker bypass (major #5).** `index-render.mjs` excludes active-epic members from the flat ACTIVE/QUEUED/LATER sections (rollup canonical), AND the worker adds an epic-member guard: a bare `/backlog-next` redirects any item whose `epic:` points to an active epic (exception: the orchestrator-driven epic-member invocation proceeds).

Should-fixes folded: run-state drops the `members` mirror (frontmatter is the single source of truth); E7.3 spins out captured members **manually** (orchestrator creates `<id>-leftovers` + repoints) since `lint --fix` does not; E6 documents env-var (not regex) e2e scoping per the strips-quotes hazard; E8 documents PR-body composition + the dual-write `BACKLOG.md` merge-conflict resolution; `--auto` debug budget is bounded (≤3 cycles → floor); standard Step 7 passes `--id`. `epic-members.mjs` is kept deliberately self-contained (liftability over de-duplication) — documented in-code.

## Verification

- `/backlog-next <non-epic-id>` behaves identically to today (Doc-layer + Complex); a
  `type: epic` id prints the redirect and stops.
- `node --test '.claude/skills/backlog-next/test/**/*.test.mjs'` green (existing
  classify-changes + new lane-classification); `node --test
  '.claude/skills/backlog-next-epic/test/**/*.test.mjs'` green (member selection).
- Dry-run `/backlog-next-epic` on a small (2–3 core member) theme epic in default mode: one
  branch, per-member integration tests, expensive e2e runs **once** at pre-done, one PR, decision
  pauses surface.
- `--auto` run: no pauses except the hard floor; decision log populated + present in the PR body;
  run-state enables resume after interrupt.
- Epic-level postflight passes after merge; `backlog-lint` green; epic `status: shipped` with a
  `validation_gate:` citing the batched e2e.
