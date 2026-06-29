# γ: backlog skills — procedure → tested `.mjs` helpers (design)

**Backlog item:** `backlog-skills-procedure-to-tested-helpers` (member of epic
`backlog-skills-simplification`, `epic_role: core`).
**Date:** 2026-06-29. **Status:** approved (helper-granularity fork confirmed via AskUserQuestion).

## 1. Problem

Three **load-bearing multi-step bash dances** are narrated directly in SKILL.md prose, where they
cannot be unit-tested and are easy to follow wrong (each currently guards a specific historical
F-bug):

- the **worktree cleanup** with the `merge-base --is-ancestor` safety check (`backlog-next` Step 6.8,
  `backlog-next-epic` E8.2 keep-branch and E8.4 delete-branch);
- the **PR merge-conflict resolution** (`backlog-next-epic` E8.1 — the `docs/BACKLOG.md`-vs-`<id>.md`
  two-kinds split, take-branch-side + `lint --fix` ordering, F-25);
- the **resume-gate / run-state branching** (`backlog-next-epic` top of Procedure — FRESH vs RESUME vs
  POST_MERGE_TAIL vs PR_STILL_OPEN dispatch).

Encapsulate each into a **tested `.mjs` helper** — the pattern `epic-members.mjs` and `runstate.mjs`
already establish (pure logic + `node --test` suites) — so SKILL.md *calls* the helper and the
correctness lives in tests, not prose.

This is a **behavior-preserving refactor**: characterization tests pin *current* behavior first, and
each helper reproduces the F-scenario the prose currently guards.

## 2. The compare-observability constraint (load-bearing — non-negotiable)

The `/benchmark-backlog` harness grades a skill run in two planes:

- **Call-log plane** — four CLIs are PATH-shim **stubs** that log to `$BEF_STUBS_LOG`:
  `gh`, `deploy.sh`, `nx`, `backlog-next-worker`. `structural-lint.mjs` enforces an allow-list
  (`STUB_BINARIES`); `grade.mjs` does substring `called:`/`neverCalled:` assertions against the log.
- **End-state plane** — `git`, worktrees, run-state JSON, and backlog frontmatter are **run for real**
  in the sandbox and graded by inspecting end-state (`git rev-parse`, `existsSync`, real `runstate.mjs
  get`, `git show <branch>:…`). `git` is deliberately **excluded** from `STUB_BINARIES`.

**Consequence that makes this refactor safe:** all three target procedures touch only **`git`** and
**`node lint.mjs`** for their side effects — both run-for-real / end-state-graded. So a helper that
`execSync('git worktree remove …')` produces the *identical* end-state as the prose and grades
identically. None of the three procedures touch `gh`/`deploy.sh`/`nx`/`backlog-next-worker`.

**Rule (enforced by design):** γ helpers shell out **only** to `git` and `node lint.mjs`. They
**never** call `gh`/`deploy.sh`/`nx`/the worker. Where the resume gate needs PR state, the prose runs
`gh pr view` (keeping `gh` observable in the call-log) and **injects** the result into the helper as a
plain argument — the helper core never calls `gh`. Swapping any stub CLI for a library would make the
shim go silent: false RED on `called:`, and the dangerous **vacuous false GREEN** on
`neverCalled:['gh pr merge']` (the no-self-merge oracle would be silently disarmed). We do not do that.

## 3. Extract-vs-leave scoring

| Candidate bash block | Verdict | Rationale |
|---|---|---|
| Resume-gate dispatch (epic top) | **EXTRACT** → `resume-gate.mjs` | Branchy crash-recovery decision; pure over `{runStatePresent, e8, prState}`. |
| Worktree cleanup + `merge-base` guard (6.8 / E8.2 / E8.4) | **EXTRACT** → `worktree-ops.mjs cleanup` | Data-loss risk in the safety guard; keep-branch vs delete-branch modes. |
| Worktree create/re-attach idempotent (E2) | **EXTRACT (bundle)** → `worktree-ops.mjs ensure` | Same lifecycle; 3-case idempotent branching is error-prone. |
| PR merge-conflict resolution (E8.1) | **EXTRACT** → `pr-conflict-resolve.mjs` | F-25 two-kinds split; wrong resolution leaves epic `active` → rule-11 blocks next epic. |
| Phantom-worktree-session self-heal (Step 4.1) | **LEAVE** | Coupled to harness `EnterWorktree`/`ExitWorktree` tools, not a `git` algorithm; one-shot. |
| Post-merge tail *sequencing* (E8.4) | **LEAVE** (cleanup folds into `worktree-ops`) | One-shot orchestration calling other helpers; only the branch-delete-safety is load-bearing → it lives in `worktree-ops cleanup`. |

## 4. The three helpers

All follow the established convention: `#!/usr/bin/env node`, JSDoc header (Usage + Exit codes),
**pure named-export core** + thin `main()` (argv → gather → call pure fn → format stdout →
`process.exit`), no default exports, `sh`/`shSafe` closures, repo paths via
`git rev-parse --show-toplevel` and cross-worktree shared paths via `--git-common-dir`. Tests import
the pure functions directly (never spawn the CLI) and run via the glob form
`node --test .claude/skills/backlog-next-epic/test/*.test.mjs`.

All three live in `.claude/skills/backlog-next-epic/`. `worktree-ops.mjs` is also invoked by
`backlog-next` Step 6.8 (one helper, two callers) — referenced by absolute skill path, consistent with
how `backlog-next-epic` already calls `backlog-next/preflight.mjs`/`postflight.mjs`.

### 4.1 `resume-gate.mjs` — pure dispatch

- **Pure core:** `decideResume({ runState, prState }) → { action, reason }` where
  `action ∈ { FRESH, RESUME, POST_MERGE_TAIL, PR_STILL_OPEN, ERROR }`.
  - `runState` is the parsed result of `runstate.mjs get` (or the FRESH/absent and malformed sentinels).
  - `prState` is the already-fetched `gh pr view --json state -q .state` string (`'MERGED'`/`'OPEN'`/…)
    — **injected**, only consulted when `runState.e8 === 'PR_OPEN_AWAITING_MERGE'`.
- **Dispatch matrix:**
  | runState | e8 | prState | action |
  |---|---|---|---|
  | absent (FRESH) | — | — | `FRESH` |
  | present | (none) | — | `RESUME` (re-enter member loop) |
  | present | `PR_OPEN_AWAITING_MERGE` | `MERGED` | `POST_MERGE_TAIL` |
  | present | `PR_OPEN_AWAITING_MERGE` | `OPEN`/other | `PR_STILL_OPEN` (re-print link, stop) |
  | malformed | — | — | `ERROR` (clean message) |
- **CLI:** `resume-gate.mjs <epic-id>` — `main()` runs `runstate.mjs get` (and, only if `e8` set,
  `gh pr view` — shelled out, observable), calls `decideResume`, prints `action=<X>`. Exit `0` for any
  resolved action; `2` malformed/usage.
- **Pins (F-11/F-13):** malformed run-state → clean `ERROR`, never a raw `SyntaxError` at resume.

### 4.2 `worktree-ops.mjs` — worktree lifecycle (two subcommands)

- **`ensure <epic-id>` (idempotent create/re-attach — E2).**
  - **Pure core:** `planEnsure({ worktreeExists, branchExists }) → { op }` where
    `op ∈ { NOOP, ATTACH, CREATE }` (worktree present→`NOOP`; branch present, worktree absent→`ATTACH`
    via `worktree add <path> <branch>`; both absent→`CREATE` via `worktree add -b <branch> <path>
    origin/main`).
  - `main()` detects state with `git worktree list` + `git rev-parse --verify`, runs the chosen
    `git worktree add …`, then ensures the `node_modules` symlink.
- **`cleanup <epic-id> --keep-branch|--delete-branch` (6.8 / E8.2 / E8.4).**
  - **Pure core:** `planCleanup({ branchMerged, mode }) → { removeWorktree, deleteBranch, prune,
    refuseReason }`. The safety law: `deleteBranch` is **true only if** `mode === 'delete-branch' &&
    branchMerged === true`; if `mode === 'delete-branch' && !branchMerged` → `deleteBranch:false` +
    `refuseReason` (never destroy unmerged work — uses the safe `branch -d`, never `-D`).
  - `main()` computes `branchMerged` via `git merge-base --is-ancestor <branch> main`, runs
    `worktree remove --force`, conditional `branch -d`, `worktree prune` — all from `$MAIN`
    (resolved via `--git-common-dir` parent), all `shSafe`.
- **CLI exit:** `0` ok; `1` refused (unmerged branch in delete mode — escalate); `2` usage.
- **Pins:** never delete an unmerged branch (safety guard); keep vs delete modes; idempotent
  re-attach when the worktree was pruned but the branch survives.

### 4.3 `pr-conflict-resolve.mjs` — F-25 two-kinds classifier

- **Pure core:** `classifyConflicts(conflictedPaths[]) → [{ path, action }]` where
  `action ∈ { REGEN_VIA_LINT, TAKE_BRANCH_SIDE }`:
  - `docs/BACKLOG.md` (the auto-index) → `REGEN_VIA_LINT` (mechanical; regenerated from merged
    frontmatter, never resolved by hand);
  - `docs/backlog/<id>.md` (epic file) and any `docs/backlog/*.md` member file → `TAKE_BRANCH_SIDE`
    (the branch carries the shipped frontmatter; keeping `main`'s `active` would rule-11-block the
    next epic).
  - Any other conflicted path → `UNKNOWN` (escalate — not auto-resolvable).
- **`main()` ordering (load-bearing):** resolve all `TAKE_BRANCH_SIDE` frontmatter files **first**
  (`git checkout --theirs <path>` for a merge where the branch is "theirs", or the correct side per
  the in-progress merge direction), `git add` them, **then** run `node lint.mjs --fix` to regenerate
  `docs/BACKLOG.md`, then `git add docs/BACKLOG.md`. Frontmatter-before-index because `lint --fix`
  renders the index from whatever frontmatter the resolution left.
- **CLI:** `pr-conflict-resolve.mjs` (reads `git diff --name-only --diff-filter=U`). Exit `0` all
  resolved; `1` an `UNKNOWN` conflict present → escalate to the human floor (AskUserQuestion); `2` usage.
- **Pins (F-25):** `<id>.md` → take-branch-side (asserts the resolved file is `status: shipped`, not
  `active`); `BACKLOG.md` → `REGEN_VIA_LINT`; ordering (frontmatter resolved before the index regen).

## 5. SKILL.md prose changes

Replace each extracted bash block with a single helper call + a one-line description of what it does;
keep the surrounding narrative (when/why) intact. Specifically:

- `backlog-next-epic` **resume gate** → `node …/resume-gate.mjs <id>` then branch on `action=`.
- `backlog-next-epic` **E2** → `node …/worktree-ops.mjs ensure <id>`.
- `backlog-next-epic` **E8.1 conflict** → `node …/pr-conflict-resolve.mjs`.
- `backlog-next-epic` **E8.2 / E8.4** and `backlog-next` **Step 6.8** →
  `node …/worktree-ops.mjs cleanup <id> --keep-branch` / `--delete-branch`.

The `gh pr view`, `deploy.sh`, `nx`, and worker invocations in the prose are **untouched** (they stay
shelling out — observability). The phantom-session self-heal (Step 4.1) and the post-merge tail
*sequencing* stay as prose.

## 6. Testing & validation

- Each helper ships a co-located `test/<helper>.test.mjs` (`node --test` glob form) pinning the
  F-scenario(s) above, importing the pure core directly.
- `node --test .claude/skills/backlog-next-epic/test/*.test.mjs` and
  `node --test .claude/skills/backlog-next/test/*.test.mjs` must pass.
- **Epic-level validation (run once at epic close, not here):** the `/benchmark-backlog` compare gate
  must show the prose-vs-helper runs grade identically (the whole point of the observability rule).

## 7. Out of scope

- Swapping any external CLI for a library (`gh`→Octokit, `deploy.sh`→AWS SDK, programmatic nx). The
  compare-observability constraint forbids it.
- Adding new benchmark-harness shims in `scripts/benchmark-backlog/stubs/` — not needed (no library
  swaps).
- Behavioral changes to the procedures — behavior-preserving only.
- Skills outside the backlog suite.
- The β LESSONS.md extraction (already shipped).
- Running the full `/benchmark-backlog` compare/eval gate (epic-close validation method).
