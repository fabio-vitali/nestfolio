---
name: backlog-next
description: Workstream router for starting the next backlog item. Picks from docs/BACKLOG.md, classifies complexity (doc-layer / simple / complex), enforces preflight/postflight gates, and routes the closing phase to deploy + true-affected-resolver validation + finishing-a-development-branch.
---

## When to invoke

User-triggered via `/backlog-next` only. `disable-model-invocation: true` in the frontmatter mechanically blocks auto-invocation and preloading into subagents — agents cannot trigger this skill from natural phrasing.

Accepts an optional `<id>` argument (`/backlog-next <id>`) that overrides the deterministic rank pick in Step 1. Without an argument, the default rule applies (resume single ACTIVE, else top-ranked QUEUED). The argument does NOT bypass any status rules — see Step 1 for the per-status dispatch.

**This skill works one member/standalone workstream — it does NOT orchestrate epics.** If `<id>` is a `type: epic`, stop and tell the user: *"epics are orchestrated by `/backlog-next-epic` — run `/backlog-next-epic <id>`."* Do not promote the epic or pick a member here. (Epic lifecycle — promote, member loop, batched e2e, single-PR close, `--auto` — lives in `/backlog-next-epic`; see [[backlog-next-epic]].)

If `/backlog-next` fires while an ACTIVE workstream is already in flight, report that state and ask whether to resume or switch — do NOT silently start a second workstream. Side-findings mid-execution go through `backlog-add`, never this skill.

**Epic-member mode (invoked by `/backlog-next-epic`).** When the orchestrator drives this skill, it passes a member `<id>` **plus an epic-member context signal** (the active epic + its worktree/branch). In that mode the worker runs the member *inside the already-active epic worktree* and hoists branch-level concerns to the epic. See § "Epic-member mode" below for the per-step deltas.

## Procedure

### 0. Preflight (enforced)

```bash
node .claude/skills/backlog-next/preflight.mjs
```

Hard-fails if: working tree is dirty, local `main` is ahead of `origin/main`, `backlog-lint` violates a rule, or stale worktrees exist. **Do not bypass.** Fix the surfaced state first — that mess is exactly what would otherwise contaminate the new workstream. See [[feedback-worktree-first-no-commits-on-main]].

### 1. Pick the item

**Default (no argument).** Read `docs/BACKLOG.md` and pick in this order:

1. A **non-epic** item with `status: active` → resume it (the standalone workstream). _(An in-flight epic member is also a non-epic active file, but you do NOT resume it via a bare `/backlog-next` — epic members are resumed by re-invoking `/backlog-next-epic <epic-id>`, which drives this worker in epic-member mode. See the epic-member guard below.)_
2. Else the **top-ranked QUEUED item** (lowest `rank`). Read `docs/backlog/<id>.md`. **Redirect to `/backlog-next-epic` and stop if** it is `type: epic` (run `/backlog-next-epic <id>`), **or** it carries an `epic:` pointer whose target epic is `status: active` (run `/backlog-next-epic <epic-id>` — it's a member of the in-flight delivery epic; working it standalone here would break the one-branch/one-PR invariant). Otherwise proceed by status.

> **Epic-member guard.** A queued/active member of an *active* epic is a non-epic file, so the `type: epic` redirect alone won't catch it. Whenever a picked item (default rank-pick OR named `<id>`) has an `epic:` pointer to a `status: active` epic, **redirect to `/backlog-next-epic <epic-id>` and stop** — do not work it standalone. **Exception:** when *this* skill is invoked BY `/backlog-next-epic` in epic-member mode (the orchestrator passes the epic context), proceed with the member — that IS the intended path; the guard fires only for bare standalone `/backlog-next` calls.
3. Else **nothing is active and QUEUED is empty** → do NOT auto-promote (promotion is a manual boundary-review call — see Common mistakes). Report that QUEUED is empty and stop for the user to choose: either promote an item into QUEUED first, or — to work an epic — launch it with `/backlog-next-epic` (which lists the available delivery/theme epics).

**With `<id>` argument (`/backlog-next <id>`).** The argument overrides the rank pick. Locate `docs/backlog/<id>.md`. **Redirect to `/backlog-next-epic` and stop if** it is `type: epic` (run `/backlog-next-epic <id>`) **or** it has an `epic:` pointer to a `status: active` epic (run `/backlog-next-epic <epic-id>` — per the epic-member guard above; not worked standalone). Otherwise dispatch by status:

| Status | Action |
|---|---|
| `queued` | Proceed with this item regardless of `rank`. Rank stays as-is. |
| `active` | Fall back to the ACTIVE-in-flight guidance in "When to invoke" — report state, ask resume vs switch. |
| `parking` | **Refuse.** Rule 8: parking entries carry unmet trigger language. Tell the user to remove the trigger sentence, document why it fired, then promote via `backlog-add` (or hand-edit to `status: queued` with a `rank`) and re-run `/backlog-next <id>`. Do NOT silently promote. |
| `shipped` or `dropped` | Almost always a typo. Warn loudly with the file's `validation_gate:` (shipped) or drop reason, and ask for confirmation before doing anything. |
| not found | Warn, list close matches from `ls docs/backlog/` (use the closest filename stems), and ask for clarification. Do NOT fall back to the default rank pick. |

Then proceed to Step 1b.

### 1b. Honor the effort marker

If the picked item's frontmatter has `effort:` set (e.g. `effort: xhigh`), the item
was triaged as needing more than the default reasoning budget. Surface it to the
user before doing any execution work — state the level and the file's stated
reason — and switch this session to that reasoning effort (or ask the user to
relaunch at it) **before** routing to a downstream skill. Do not start a marked
workstream at the default effort. Absent an `effort:` key, use your own judgment.

### 2. Verify references

`backlog-lint` confirms paths/anchors exist but not that cited sections still *mean* what the file claims. Re-read each `references:` target. If any is stale, fix the doc layer first. See [[feedback-verify-before-documenting]].

### 3. Classify complexity

| Lane | Triggers | Where to work |
|------|----------|---------------|
| **Doc-layer** | Only touches `docs/backlog/`, `MEMORY.md`, `BACKLOG.md`. | `main`. See [[feedback-docs-backlog-commits-go-to-main]]. |
| **Simple** | Single service or single MFE, no large blast radius. Multi-file/multi-line is fine. **Disqualifiers:** requires deploy + e2e validation gate, OR changes a public interface (event contract, CDK construct API, flow spec, shared lib export), OR introduces an architectural decision worth surfacing. | `main`. See [[feedback-simple-fixes-stay-on-main]]. |
| **Complex** | The workstream will produce **code or infra changes** (not just docs): `requires_deploy: true` in frontmatter, OR crosses services/domains, OR hits a Simple-lane disqualifier above, OR a `type: design`/`type: spec` workstream whose done-definition includes an implementation commit (not just the spec doc). | **Worktree FIRST**. See [[feedback-worktree-first-no-commits-on-main]]. |

**Edge case — spec-only design workstreams stay Doc-layer.** A `type: design` or `type: spec` workstream whose done-definition is "spec or design doc exists, reviewed, lands in `docs/superpowers/specs/`" produces only doc files. That ships on `main` as Doc-layer. The follow-up implementation workstream (which will produce code) gets its own backlog file and goes through Complex.

If midway you realize the lane was wrong (started Simple, architectural decision surfaces), STOP and upgrade. See [[feedback-pivot-to-worktree]].

### 4. Adopt to ACTIVE (Complex lane only)

1. `EnterWorktree` — branches from `origin/main`. **Do NOT commit on `main` first**; preflight already verified main is clean.
   - **Self-heal a phantom worktree session.** If `EnterWorktree` errors with `Already in a worktree session`, a PRIOR session left its worktree session flag set (Step 6.8 git-removed the worktree on disk but `ExitWorktree` could not clear the harness flag from a cwd-pinned session) — so the harness still thinks it's inside a worktree that has since been removed from disk. Preflight cannot catch this — Node can't see harness session state, and the phantom case leaves no disk artifact. Recover in place: confirm disk is clean (`git rev-parse --abbrev-ref HEAD` on `main`, `git status --short` empty, `git worktree list` shows no unexpected entry), then call `ExitWorktree` with `action: "keep"` to clear the dead session (`keep` never deletes, so real work is never lost), then retry `EnterWorktree`. `ExitWorktree action: "keep"` works HERE (unlike Step 6.8) precisely because the phantom worktree is already gone from disk, so there is no live worktree cwd for it to mutate — the cwd has already recovered to `main`. (If `git worktree list` shows a stale registration for the removed path, `git worktree prune` first.) Only if `git worktree list` + `git status` reveal genuine uncommitted work in a real leftover worktree, stop and ask the user before clearing. This phantom is almost always the residue of a prior run that could not `ExitWorktree` — Step 6.8's git cleanup is what prevents it; an upstream request to have `EnterWorktree`/`ExitWorktree` auto-reconcile a removed-on-disk session (and to allow `ExitWorktree` from a cwd-pinned session) lives in the harness tools, not here.
2. Inside the worktree: edit `docs/backlog/<id>.md` → `status: active`, fill `out_of_scope:` (rule 4). Commit. **Use the worktree's own path for every edit** — `EnterWorktree` switches the harness cwd but the Edit tool resolves absolute paths verbatim, so a path under the original repo root silently writes to `main`'s checkout instead of the worktree. After the first edit, `git status --short` in the worktree to confirm the change actually landed there.
3. `node .claude/skills/backlog-lint/lint.mjs --fix`. Commit the regenerated `docs/BACKLOG.md`.

Doc-layer and Simple lanes skip adoption — work the item directly on `main`.

### 5. Route to the downstream skill

| Item state | Skill |
|------------|-------|
| `type: design`, no spec yet | `superpowers:brainstorming` → produces spec |
| Has spec, no plan | `superpowers:writing-plans` |
| Has plan | `superpowers:executing-plans` |
| Architectural ambiguity surfaces | `superpowers:brainstorming` first |
| New service / feature / event / data flow / MFE | Matching `create-*` / `design-*` skill from `CLAUDE.md` routing table |

### 6. Closing phase

Run the steps in order. Each one is a single command; the agent reads the output and acts.

**6.1 Regen derived docs first.**

```bash
node .claude/skills/backlog-next/detect-doc-derivation.mjs
```

Exit 0 ⇒ derivation needed. The output lists which skills to run (`generate-c4-diagrams`, `audit-service <svc>`, `validate-flow <spec>`, etc.). Run them, resolve any inconsistencies they surface, and commit the regen **in the same workstream**. Source + derived must ship together. See `doc-derivation-paths.md` for the full mapping.

**6.2 Verify with the true-affected resolver.**

```bash
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -)
[ -n "$AFFECTED" ] && pnpm nx run-many -t test,lint -p "$AFFECTED" || echo "no affected projects"
```

(`tools/affected-projects.mjs` replaces `nx affected`, which over-reports the
full event-processor closure for any single-service change.)

Must pass before any deploy fires. Auto-deploying broken code wastes a cycle.

**6.3 Detect deploy needs.**

```bash
node .claude/skills/backlog-next/detect-deploy-needed.mjs
```

Exit 0 ⇒ deploy needed (script prints the affected services). Exit 10 ⇒ skip 6.4 entirely. See `deploy-paths.md` for the mapping.

**6.4 Deploy + scoped validation (only if 6.3 said deploy).**

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=<from-detect-output>
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main --with-target=test-integration | paste -sd, -)
[ -n "$AFFECTED" ] && pnpm nx run-many -t test-integration -p "$AFFECTED" || echo "no affected integration suites"
```

Then run only the **involved** `apps/e2e-feature-tests` scenarios — pick from the workstream's context (which flows/services it touched). **NEVER the full e2e suite. NEVER Playwright.** See [[feedback-always-rerun-e2e]]. If any scenario fails-then-passes on a rerun, pull CloudWatch evidence from the failing window before continuing and run a second confirmation pass — flakes are real failures, not noise. See [[feedback-flake-means-broken]]. Dev-account operations need no confirmation — see [[feedback-sole-dev-no-shared-caution]].

**6.5 Ship the backlog file.** Edit `docs/backlog/<id>.md` → `status: shipped`, fill `validation_gate:` with concrete evidence (commit SHA, deploy log line, integ/e2e command output). Commit.

**6.6 Regen index.** `node .claude/skills/backlog-lint/lint.mjs --fix`. Commit.

> The shipped item's "Recently Shipped" date is derived in `index-render.mjs` as `closed: ?? (dirty → today) ?? git-last-commit-date`. The **dirty → today** rule makes the date stable whether you run `--fix` before or after the ship commit — so batching 6.5+6.6 into one commit no longer "settles" the date forward on a second `--fix`. Set `closed: <date>` in frontmatter only when you need to record a ship date other than today (e.g. backfilling history).

**6.7 Complex lane only:** route to `superpowers:finishing-a-development-branch` for merge / PR / branch cleanup. Do NOT handle the merge manually. **If the local-merge option is chosen, push `main` afterward** — `git push origin main`. The local-merge path does NOT push, but postflight's `main-sync` check AND the next run's preflight both require local `main` == `origin/main` (a local-but-unpushed merge leaves `main` ahead and blocks the next workstream). Pushing the project's own `main` is the routine completion — prior shipped workstreams are already on `origin/main`; it is a dev-account op, not a production/real-money action ([[feedback-sole-dev-no-shared-caution]]). The PR option pushes as part of its own flow.

**6.8 Complex lane only — clean up the worktree + branch + session (git, NOT `ExitWorktree`).** `finishing-a-development-branch` merges, but for a **harness-owned** worktree (under `.claude/worktrees/`) it deliberately leaves the directory on disk and cannot `git branch -d` the still-checked-out branch — so the cleanup lands here. `ExitWorktree` is the *nominal* tool, **but in a cwd-pinned / isolated session it reliably fails** with `ExitWorktree cannot be called from a subagent with a cwd override … use Bash with cd`. This is the COMMON case, not an edge case: `/backlog-next` sessions are typically launched or resumed pinned to a worktree cwd, and `ExitWorktree` refuses to mutate a cwd-pinned agent's process-wide cwd. **Do NOT call `ExitWorktree` here and do NOT retry it.** Clean up with git from the **main repo root** (`cd` there explicitly — the worktree may be your pinned cwd, and `git worktree remove` run from inside the worktree-being-removed fails):

```bash
MAIN=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
# Safety: confirm every branch commit is already on main (the 6.7 merge makes this true)
git -C "$MAIN" merge-base --is-ancestor <feature-branch> main && echo SAFE-TO-REMOVE
git -C "$MAIN" worktree remove ".claude/worktrees/<name>" --force
git -C "$MAIN" branch -d <feature-branch>
git -C "$MAIN" worktree prune
```

This is the **durable fix for the `ExitWorktree`-always-fails problem** and it **breaks the phantom-session leak cycle**: a worktree left on disk is what the *next* session gets launched pinned to (the `Already in a worktree session` phantom Step 4 self-heals). Once the git cleanup above has *removed* the worktree, the next session's pinned path no longer exists → its cwd recovers to `main` on the first command → Step 4's `ExitWorktree action: "keep"` works (no live worktree cwd to mutate) and clears the dead flag. You may, optionally, call `ExitWorktree action: "keep"` now best-effort to clear the flag immediately; if it errors with the cwd-override message, **ignore it** — the on-disk state is already correct and Step 7 postflight checks on-disk truth (worktree gone, branch deleted, `main` synced), not the harness session flag.

> Root fix (either `ExitWorktree` succeeding from a cwd-pinned session, or `/backlog-next` not being launched cwd-pinned) lives in the harness, not this repo, and is filed as an upstream request. Until then, the git cleanup above is the path — verified end-to-end 2026-06-03.

### 7. Postflight (enforced)

```bash
node .claude/skills/backlog-next/postflight.mjs --lane=<doc-layer|simple|complex|epic-member> --id=<id> [--branch=<feat-branch>]
```

Hard-fails if: working tree is dirty, `backlog-lint` violates a rule, the shipped item's frontmatter is incomplete, the feature branch wasn't merged + deleted (Complex), or stale worktrees remain. Fix before declaring the job done. (`--lane=epic-member` runs only checks 1–3 — tree-clean, lint, shipped frontmatter — because the member stays on the epic branch; the merge/sync/branch-delete checks belong to the epic-level close run by `/backlog-next-epic`.)

## Epic-member mode (invoked by `/backlog-next-epic`)

When the `/backlog-next-epic` orchestrator drives this skill, it passes the member `<id>` **plus an epic-member context signal**: the active delivery epic, its branch `feat/epic-<id>`, and its already-checked-out worktree. The orchestrator owns the epic worktree, the single merge/PR, and the expensive e2e — so the worker runs the member *inside that worktree* and **hoists branch-level concerns to the epic**. Apply these deltas to the standard procedure:

- **Step 0 (Preflight).** Run `node .claude/skills/backlog-next/preflight.mjs --lane=epic-member` instead of the standard preflight. It checks only tree-clean (within the worktree) + `backlog-lint`; it skips the on-main / main-ahead / stale-worktree checks and the snapshot+daemon side-effects (the orchestrator already ran the full preflight once at epic-start).
- **Step 3 (Classify) + Step 4 (Adopt).** The member is **always** worked inside the existing epic worktree. Do **NOT** `EnterWorktree` (skip Step 4.1) — the epic branch is already checked out. Still flip the member `docs/backlog/<id>.md` → `status: active`, fill `out_of_scope:`, and commit **on the epic branch** (4.2), then `backlog-lint --fix` + commit (4.3). Use the worktree's own path for every edit.
- **Step 5 (Downstream routing).** Route to the same downstream skill as usual, with ONE critical change: `superpowers:executing-plans` and `superpowers:subagent-driven-development` end with an **unconditional handoff to `superpowers:finishing-a-development-branch`** (their "complete development" step). In epic-member mode you must **drive only their task-execution phase and STOP before that finishing handoff** — the member is "done" at commit-on-branch + green per-member integration tests. Do NOT let the downstream skill open a PR, merge, or clean the branch; **return control to `/backlog-next-epic`**. This is what preserves the one-branch/one-PR invariant: the finishing handoff is the orchestrator's job at epic close (E8), never the member's. (If a member routes to `superpowers:brainstorming` for a `type: design` slice, see the orchestrator's E5 — in `--auto` such members do not auto-resolve the brainstorming approval gate.)
- **Step 6.4 (Deploy + validation).** Run the per-member **integration** tests (and a per-member deploy if 6.3 says so), but **SKIP the e2e block** — the expensive Jest e2e + Playwright run once at epic pre-done, batched by the orchestrator.
- **Step 6.7 / 6.8 (Finish + cleanup).** **SKIP both.** Do NOT route to `finishing-a-development-branch`, do NOT clean up the worktree, do NOT push `main`. The orchestrator does one merge / one PR / one cleanup at epic close.
- **Step 7 (Postflight).** Run `node .claude/skills/backlog-next/postflight.mjs --lane=epic-member --id=<id>` (checks 1–3 only). Then **return control to `/backlog-next-epic`** — it advances to the next member or moves to the epic pre-done gate.

Everything else (Step 1b effort marker, Step 2 verify references, Steps 6.1–6.3, 6.5–6.6) runs unchanged. (Step 1 "Pick" does not run in epic-member mode — the orchestrator supplies the member id, so the worker starts at Step 1b.)

## Common mistakes

- **Skipping preflight or postflight.** Both are hard gates, not advisory. The "just one quick frontmatter tweak on main before the worktree" is the start of every cascade; declaring shipped without postflight is how stale worktrees and unpushed main commits accumulate.
- **Reimplementing `finishing-a-development-branch`.** This skill routes to it — do NOT run `gh pr create` + `gh pr merge --squash` manually in the closing phase. The skill knows about branch deletion, fast-forward reconciliation, and `gh pr merge --delete-branch` ordering.
- **Auto-promoting LATER → QUEUED.** Promotion is a judgment call — do it manually at the boundary review.
- **Splitting source from derived across PRs.** Both ship in the same workstream. See `doc-derivation-paths.md`.
- **Dismissing flakes after one rerun.** See [[feedback-flake-means-broken]]. If a scoped e2e scenario fails-then-passes, pull evidence from the failing window before continuing; a confirmation rerun is required, not optional. E2E flakes are QUEUED, never parking — see [[feedback-e2e-gaps-queued-not-parking]].
- **Trying to `ExitWorktree` for cleanup in Step 6.8.** It reliably FAILS in a cwd-pinned session (`cannot be called from a subagent with a cwd override`). Use Step 6.8's **git cleanup** (`worktree remove --force` + `branch -d` + `prune` from the main root) — that is the reliable path and it breaks the phantom-session leak cycle. Leaving the worktree on disk is what makes the next run launch pinned to it.
- **Local merge without pushing `main`.** `finishing-a-development-branch`'s local-merge path does not push; postflight `main-sync` and the next preflight both require `main` == `origin/main`. Push in 6.7.

## Related

`backlog-next-epic` (the epic orchestrator that drives this skill in epic-member mode), `backlog-add`, `backlog-lint`, `superpowers:brainstorming` / `writing-plans` / `using-git-worktrees` / `executing-plans` / `finishing-a-development-branch`. Supporting files in this skill: `deploy-paths.md`, `doc-derivation-paths.md`, `preflight.mjs`, `postflight.mjs`, `detect-deploy-needed.mjs`, `detect-doc-derivation.mjs`.
