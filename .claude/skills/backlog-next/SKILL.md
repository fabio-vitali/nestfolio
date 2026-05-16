---
name: backlog-next
description: User-triggered router (`/backlog-next`) — picks the next backlog item from docs/BACKLOG.md, classifies its complexity (doc-layer / simple / complex), enforces preflight/postflight gates, and routes the closing phase to deploy + nx-affected validation. Invoke ONLY when the user explicitly types `/backlog-next` or names this skill directly; do NOT auto-invoke from natural phrasing like "what's next?" or session-start heuristics.
---

## When to invoke

**ONLY when the user explicitly types `/backlog-next`** (or directly names this skill). Do NOT auto-invoke from "what's next?", session start, or after a ship — the user wants explicit control over when this routing runs.

If `/backlog-next` fires while an ACTIVE workstream is already in flight, the agent should report that state and ask whether to resume or switch, not silently start a second workstream. Side-findings mid-execution still go through `backlog-add`, never this skill.

## Procedure

### 0. Preflight (enforced)

```bash
node .claude/skills/backlog-next/preflight.mjs
```

Hard-fails if: working tree is dirty, local `main` is ahead of `origin/main`, `backlog-lint` violates a rule, or stale worktrees exist. **Do not bypass.** Fix the surfaced state first — that mess is exactly what would otherwise contaminate the new workstream. See [[feedback-worktree-first-no-commits-on-main]].

### 1. Pick the item

Read `docs/BACKLOG.md`. If exactly one item is `status: active`, resume it. Otherwise pick the top-ranked QUEUED item. Read `docs/backlog/<id>.md`.

### 2. Verify references

`backlog-lint` confirms paths/anchors exist but not that cited sections still *mean* what the file claims. Re-read each `references:` target. If any is stale, fix the doc layer first. See [[feedback-verify-before-documenting]].

### 3. Classify complexity

| Lane | Triggers | Where to work |
|------|----------|---------------|
| **Doc-layer** | Only touches `docs/backlog/`, `MEMORY.md`, `BACKLOG.md`. | `main`. See [[feedback-docs-backlog-commits-go-to-main]]. |
| **Simple** | Single service or single MFE, no large blast radius. Multi-file/multi-line is fine. **Disqualifiers:** requires deploy + e2e validation gate, OR changes a public interface (event contract, CDK construct API, flow spec, shared lib export), OR introduces an architectural decision worth surfacing. | `main`. See [[feedback-simple-fixes-stay-on-main]]. |
| **Complex** | `type ∈ {design, spec}`, OR `requires_deploy: true` in frontmatter, OR crosses services/domains, OR hits a disqualifier above. | **Worktree FIRST**. See [[feedback-worktree-first-no-commits-on-main]]. |

If midway you realize the lane was wrong (started Simple, architectural decision surfaces), STOP and upgrade. See [[feedback-pivot-to-worktree]].

### 4. Adopt to ACTIVE (Complex lane only)

1. `EnterWorktree` — branches from `origin/main`. **Do NOT commit on `main` first**; preflight already verified main is clean.
2. Inside the worktree: edit `docs/backlog/<id>.md` → `status: active`, fill `out_of_scope:` (rule 4). Commit.
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

Then run only the **involved** `apps/e2e-feature-tests` scenarios — pick from the workstream's context (which flows/services it touched). **NEVER the full e2e suite. NEVER Playwright.** See [[feedback-always-rerun-e2e]]. Dev-account operations need no confirmation — see [[feedback-sole-dev-no-shared-caution]].

**6.5 Ship the backlog file.** Edit `docs/backlog/<id>.md` → `status: shipped`, fill `validation_gate:` with concrete evidence (commit SHA, deploy log line, integ/e2e command output). Commit.

**6.6 Regen index.** `node .claude/skills/backlog-lint/lint.mjs --fix`. Commit.

**6.7 Complex lane only:** route to `superpowers:finishing-a-development-branch` for merge / PR / branch cleanup. Do NOT handle the merge manually.

### 7. Postflight (enforced)

```bash
node .claude/skills/backlog-next/postflight.mjs --lane=<doc-layer|simple|complex> [--branch=<feat-branch>]
```

Hard-fails if: working tree is dirty, `backlog-lint` violates a rule, the shipped item's frontmatter is incomplete, the feature branch wasn't merged + deleted (Complex), or stale worktrees remain. Fix before declaring the job done.

## Common mistakes

- **Skipping preflight.** The "just one quick frontmatter tweak on main before the worktree" is the start of every cascade.
- **Reimplementing `finishing-a-development-branch`.** This skill routes to it; do not `gh pr merge` manually.
- **Auto-promoting LATER → QUEUED.** Promotion is a judgment call — do it manually at the boundary review.
- **Splitting source from derived across PRs.** Both ship in the same workstream. See `doc-derivation-paths.md`.
- **Dismissing flakes.** See [[feedback-flake-means-broken]]. E2E flakes are QUEUED, never parking — see [[feedback-e2e-gaps-queued-not-parking]].

## Related

`backlog-add`, `backlog-lint`, `superpowers:brainstorming` / `writing-plans` / `using-git-worktrees` / `executing-plans` / `finishing-a-development-branch`. Supporting files in this skill: `deploy-paths.md`, `doc-derivation-paths.md`, `preflight.mjs`, `postflight.mjs`, `detect-deploy-needed.mjs`, `detect-doc-derivation.mjs`.
