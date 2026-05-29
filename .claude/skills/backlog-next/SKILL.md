---
name: backlog-next
description: Workstream router for starting the next backlog item. Picks from docs/BACKLOG.md, classifies complexity (doc-layer / simple / complex), enforces preflight/postflight gates, and routes the closing phase to deploy + nx-affected validation + finishing-a-development-branch.
disable-model-invocation: true
---

## When to invoke

User-triggered via `/backlog-next` only. `disable-model-invocation: true` in the frontmatter mechanically blocks auto-invocation and preloading into subagents — agents cannot trigger this skill from natural phrasing.

Accepts an optional `<id>` argument (`/backlog-next <id>`) that overrides the deterministic rank pick in Step 1. Without an argument, the default rule applies (resume single ACTIVE, else top-ranked QUEUED). The argument does NOT bypass any status rules — see Step 1 for the per-status dispatch.

If `/backlog-next` fires while an ACTIVE workstream is already in flight, report that state and ask whether to resume or switch — do NOT silently start a second workstream. Side-findings mid-execution go through `backlog-add`, never this skill.

## Procedure

### 0. Preflight (enforced)

```bash
node .claude/skills/backlog-next/preflight.mjs
```

Hard-fails if: working tree is dirty, local `main` is ahead of `origin/main`, `backlog-lint` violates a rule, or stale worktrees exist. **Do not bypass.** Fix the surfaced state first — that mess is exactly what would otherwise contaminate the new workstream. See [[feedback-worktree-first-no-commits-on-main]].

### 1. Pick the item

**Default (no argument).** Read `docs/BACKLOG.md`. If exactly one item is `status: active`, resume it. Otherwise pick the top-ranked QUEUED item. Read `docs/backlog/<id>.md`.

**With `<id>` argument (`/backlog-next <id>`).** The argument overrides the rank pick. Locate `docs/backlog/<id>.md` and dispatch by status:

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
   - **Self-heal a phantom worktree session.** If `EnterWorktree` errors with `Already in a worktree session`, a PRIOR session forgot Step 6.8 (`ExitWorktree`) and the harness still thinks it's inside a worktree that may since have been removed from disk. Preflight cannot catch this — Node can't see harness session state, and the phantom case leaves no disk artifact. Recover in place: confirm disk is clean (`git rev-parse --abbrev-ref HEAD` on `main`, `git status --short` empty, `git worktree list` shows no unexpected entry), then call `ExitWorktree` with `action: "keep"` to clear the dead session (`keep` never deletes, so real work is never lost), then retry `EnterWorktree`. Only if `git worktree list` + `git status` reveal genuine uncommitted work in a real leftover worktree, stop and ask the user before clearing. An upstream request to have `EnterWorktree`/`ExitWorktree` auto-reconcile a removed-on-disk session lives in the harness tools, not here.
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

**6.2 Verify with nx affected.**

```bash
pnpm nx affected -t test,lint --base=origin/main
```

Must pass before any deploy fires. Auto-deploying broken code wastes a cycle.

**6.3 Detect deploy needs.**

```bash
node .claude/skills/backlog-next/detect-deploy-needed.mjs
```

Exit 0 ⇒ deploy needed (script prints the affected services). Exit 10 ⇒ skip 6.4 entirely. See `deploy-paths.md` for the mapping.

**6.4 Deploy + scoped validation (only if 6.3 said deploy).**

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=<from-detect-output>
pnpm nx affected -t test-integration --base=origin/main
```

Then run only the **involved** `apps/e2e-feature-tests` scenarios — pick from the workstream's context (which flows/services it touched). **NEVER the full e2e suite. NEVER Playwright.** See [[feedback-always-rerun-e2e]]. If any scenario fails-then-passes on a rerun, pull CloudWatch evidence from the failing window before continuing and run a second confirmation pass — flakes are real failures, not noise. See [[feedback-flake-means-broken]]. Dev-account operations need no confirmation — see [[feedback-sole-dev-no-shared-caution]].

**6.5 Ship the backlog file.** Edit `docs/backlog/<id>.md` → `status: shipped`, fill `validation_gate:` with concrete evidence (commit SHA, deploy log line, integ/e2e command output). Commit.

**6.6 Regen index.** `node .claude/skills/backlog-lint/lint.mjs --fix`. Commit.

**6.7 Complex lane only:** route to `superpowers:finishing-a-development-branch` for merge / PR / branch cleanup. Do NOT handle the merge manually.

**6.8 Complex lane only — exit the worktree session.** After `finishing-a-development-branch` returns, call `ExitWorktree`. The merge skill cleans up the on-disk worktree and feature branch, but the Claude Code worktree **session** is harness state and must be exited explicitly. Skipping this means the next `/backlog-next` fails at Step 4 with `Already in a worktree session. Use ExitWorktree to leave it before entering another.` Postflight cannot detect this (Node can't see harness session state), so the discipline lives here.

**Expected ExitWorktree warning after a clean merge.** Once `finishing-a-development-branch` has fast-forward- or squash-merged the feature branch into `main`, `ExitWorktree action: "remove"` warns it will "discard N commits permanently". This is expected: the worktree branch's commits are not reachable as a distinct branch tip, but their content is on `main`. Verify it is safe with `git merge-base --is-ancestor <feature-branch> main` (exit 0 ⇒ every branch commit is an ancestor of `main`), then re-invoke `ExitWorktree` with `discard_changes: true`. Do NOT treat the warning as a sign of lost work. A cherry-equivalence check that would downgrade this to an informational notice belongs in the `ExitWorktree` harness tool itself (not repo code) and is filed as an upstream request.

### 7. Postflight (enforced)

```bash
node .claude/skills/backlog-next/postflight.mjs --lane=<doc-layer|simple|complex> [--branch=<feat-branch>]
```

Hard-fails if: working tree is dirty, `backlog-lint` violates a rule, the shipped item's frontmatter is incomplete, the feature branch wasn't merged + deleted (Complex), or stale worktrees remain. Fix before declaring the job done.

## Common mistakes

- **Skipping preflight or postflight.** Both are hard gates, not advisory. The "just one quick frontmatter tweak on main before the worktree" is the start of every cascade; declaring shipped without postflight is how stale worktrees and unpushed main commits accumulate.
- **Reimplementing `finishing-a-development-branch`.** This skill routes to it — do NOT run `gh pr create` + `gh pr merge --squash` manually in the closing phase. The skill knows about branch deletion, fast-forward reconciliation, and `gh pr merge --delete-branch` ordering.
- **Auto-promoting LATER → QUEUED.** Promotion is a judgment call — do it manually at the boundary review.
- **Splitting source from derived across PRs.** Both ship in the same workstream. See `doc-derivation-paths.md`.
- **Dismissing flakes after one rerun.** See [[feedback-flake-means-broken]]. If a scoped e2e scenario fails-then-passes, pull evidence from the failing window before continuing; a confirmation rerun is required, not optional. E2E flakes are QUEUED, never parking — see [[feedback-e2e-gaps-queued-not-parking]].
- **Forgetting `ExitWorktree` after the merge skill returns.** Step 6.8 is the only place that catches this; postflight can't see harness session state, so the failure only surfaces on the next `/backlog-next` at `EnterWorktree`.

## Related

`backlog-add`, `backlog-lint`, `superpowers:brainstorming` / `writing-plans` / `using-git-worktrees` / `executing-plans` / `finishing-a-development-branch`. Supporting files in this skill: `deploy-paths.md`, `doc-derivation-paths.md`, `preflight.mjs`, `postflight.mjs`, `detect-deploy-needed.mjs`, `detect-doc-derivation.mjs`.
