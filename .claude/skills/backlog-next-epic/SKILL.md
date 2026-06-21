---
name: backlog-next-epic
description: Epic orchestrator — runs a whole delivery epic as ONE branch / ONE PR. Promotes the epic, loops its core members through /backlog-next in epic-member mode, batches the expensive e2e at epic pre-done, runs the captured audit, and ships via a single PR. Optional --auto mode auto-resolves decisions (logging each, with a hard floor) for fire-and-forget.
disable-model-invocation: true
---

## When to invoke

User-triggered via `/backlog-next-epic [<epic-id>] [--auto]` only. `disable-model-invocation: true` blocks auto-invocation.

- `<epic-id>` — a `type: epic` backlog file. Without it, list the candidate epics (active delivery epic first, then `queued`, then parking theme epics with open-core-member counts) and ask which to run.
- `--auto` — fire-and-forget: auto-resolve decisions and log each for PR review, pausing only on the hard floor (see § E5). Without it, the orchestrator pauses at every architectural fork.

This skill owns the **epic lifecycle**. It does NOT execute member work directly — it drives `/backlog-next` in **epic-member mode** (one member at a time, inside one shared worktree). For a single non-epic workstream, use `/backlog-next` directly.

## Relationship to `/backlog-next`

| Concern | Owner |
|---------|-------|
| Pick/execute one member workstream (lane, spec→plan→code, per-member integration tests, doc-derivation, member ship) | `/backlog-next` (epic-member mode) |
| Promote the epic, rule-11 guard, member ordering, the single worktree/branch | **this skill** |
| Batched expensive e2e (Jest e2e + Playwright) at epic pre-done | **this skill** |
| Captured audit, epic ship, single PR + cleanup, epic-level postflight | **this skill** |
| `--auto` decision policy + decision log + hard floor | **this skill** |

Member ordering is the tested helper `epic-members.mjs` (the deterministic pick that used to be inline bash in `/backlog-next` Step 1a).

## Procedure

### E0. Epic-start preflight (once)

```bash
node .claude/skills/backlog-next/preflight.mjs
```

Standard lane: tree clean, `main` == `origin/main`, `backlog-lint` green, no stale worktrees. Do not bypass. This runs **once** for the whole epic; per-member preflight later uses `--lane=epic-member`.

### E1. Resolve + promote the epic

```bash
node .claude/skills/backlog-next-epic/epic-members.mjs <epic-id>   # roster + next core member (exit 10 = already drainable)
```

- **Rule 11 guard.** If a *different* epic is already `status: active`, stop and ask resume-vs-switch — never promote a second delivery epic.
- **Promote.** Set the target epic `status: active`; ensure `done_when:` + `scope:` + `out_of_scope:` are present (rule 4). Commit this **promotion marker on `main`** and push (docs-backlog-on-main convention; makes the in-flight epic + its branch name visible for crash-recovery). `node .claude/skills/backlog-lint/lint.mjs --fix`, commit the index.
- If `epic-members.mjs` already reports the epic **drainable** (exit 10) before any work, skip to E7 (captured audit + ship).

### E2. Create the single epic worktree + branch

One worktree for the whole epic — every member commits here; `main` moves only at the single merge.

```bash
MAIN=$(git rev-parse --show-toplevel)
git -C "$MAIN" fetch origin main --quiet
git -C "$MAIN" worktree add -b feat/epic-<id> .claude/worktrees/epic-<id> origin/main
ln -s "$MAIN/node_modules" .claude/worktrees/epic-<id>/node_modules   # see [[feedback-worktree-deploy-friction]]
```

Branch from `origin/main` to bound drift. All subsequent member work happens with this worktree as cwd, on `feat/epic-<id>`.

### E3. Initialize run-state (resumability)

Write `<git-common-dir>/backlog-next-epic-<id>.json`:

```json
{ "epic": "<id>", "branch": "feat/epic-<id>", "worktree": ".claude/worktrees/epic-<id>",
  "auto": false, "members": { "<member-id>": "pending|active|shipped|dropped" },
  "decisions": [], "e2e": null }
```

Re-invoking `/backlog-next-epic <id>` reads this and resumes at the next open member (idempotent). Initialize `members` from the `epic-members.mjs` roster.

### E4. Member loop

Repeat until `epic-members.mjs` reports drainable (exit 10):

1. **Pick** the next core member from `epic-members.mjs` (`next=<member-id>`).
2. **Run** `/backlog-next <member-id>` in **epic-member mode** — pass the epic context (active epic `<id>`, branch `feat/epic-<id>`, worktree). The worker applies its § "Epic-member mode" deltas: preflight/postflight `--lane=epic-member`, work inside this worktree, commit on the branch, run **per-member integration tests** only, and **skip** the expensive e2e / finishing / cleanup / push.
3. **Per-member gate.** The member's integration tests (and doc-derivation) must be green before advancing — a failure is NOT a decision: route to `superpowers:systematic-debugging`; in `--auto`, attempt the fix, and pause only if it cannot be resolved within a bounded effort.
4. **Update run-state** (`members[<id>] = shipped`); update the decision log if any fork fired (E5).
5. Loop.

### E5. Decision handling (default vs `--auto`)

A **decision** is an architectural/design fork the worker would normally surface (it would invoke `superpowers:brainstorming` or an AskUserQuestion). Test/build failures are NOT decisions (see E4.3).

- **Default mode:** at each decision, **pause** — surface it via AskUserQuestion (mark the recommended option per the project rule), take the user's choice, record it in the decision log, resume.
- **`--auto` mode:** do **NOT** pause for normal decisions. Resolve each by selecting the option the project marks **(Recommended)** — which per `CLAUDE.md` § "Hard Constraints" is the **most reusable / generalizable / cleanly-abstracted** option (reusability breaks ties). Append to the decision log: `{ member, decision, options, chosen, rationale (the reuse rationale), rejected }`. Continue.

  **Hard floor — pause even in `--auto`:**
  1. **Irreversible / outward-facing actions** — anything in `CLAUDE.md` § "Still requires explicit confirmation": staging/prod-account ops, real-money/broker actions, `git push --force`, `git reset --hard` on shared branches, `git branch -D`, destructive deletes, mutations outside `dev-*` naming, anything outside this repo. These are confirmed with the user regardless of `--auto`.
  2. **No defensible recommended option** — a genuinely balanced fork where reusability does not break the tie, or one whose divergent choices carry large downstream blast radius across remaining members. Pause and ask.

  When the floor fires, surface via AskUserQuestion, record the outcome, resume. The decision log is the asynchronous-review surface that replaces synchronous approval — it lands in the PR body (E8).

### E6. Epic pre-done — batched expensive e2e (the new gate)

Once `epic-members.mjs` reports drainable, validate the **cumulative** branch state as a unit:

```bash
# Deploy everything the epic touched (true-affected over the whole branch diff).
node .claude/skills/backlog-next/detect-deploy-needed.mjs          # services across the full branch vs origin/main
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=<from-detect>   # if deploy needed
```

Then run the expensive e2e **once**, scoped to the flows/journeys the epic touched:

```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features   # scoped Jest e2e
pnpm nx run nestfolio-e2e:e2e                                                # scoped Playwright journeys
```

- Choose the **repeat count at epic-start** by risk; if it is ≥ the cost-conscious threshold (e.g. 5 consecutive runs), surface it via AskUserQuestion **even in `--auto`** (cost is floor-adjacent). See [[feedback-e2e-cost-conscious]].
- A scenario that fails-then-passes is a real failure: pull CloudWatch evidence from the failing window and run a confirmation pass — never dismiss as flake ([[feedback-flake-means-broken]]). An e2e gap that blocks the epic is `queued`, never parking ([[feedback-e2e-gaps-queued-not-parking]]).
- Record the e2e evidence in run-state `e2e` (commands + outcome + SHA).

### E7. Captured audit + epic ship

1. **Captured audit.** `lint.mjs` prints the active epic's open captured members. Re-test each against `done_when` (closure-predicate test). Promote any load-bearing one to `core` — then it must be resolved/dropped (it does NOT spin out), which sends you back to E4 for that member.
2. **Rule 9.** Confirm every core member is terminal (`epic-members.mjs` exit 10).
3. **Ship the epic.** Edit `docs/backlog/<id>.md` → `status: shipped`, fill `validation_gate:` with the batched-e2e evidence + branch SHA. Commit on the branch.
4. `node .claude/skills/backlog-lint/lint.mjs --fix` (auto-spins genuinely-orthogonal captured members into `<id>-leftovers`). Commit.

### E8. Single PR + cleanup + epic postflight

1. Route to `superpowers:finishing-a-development-branch` for the **one** epic PR. **PR body = the decision log (E5) + a per-member commit summary.** Do not handle the merge manually.
2. After merge, clean up from the main repo root (NOT `ExitWorktree` — see [[feedback-exitworktree-fails-cwd-pinned]]):

```bash
MAIN=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
git -C "$MAIN" merge-base --is-ancestor feat/epic-<id> main && echo SAFE-TO-REMOVE
git -C "$MAIN" worktree remove ".claude/worktrees/epic-<id>" --force
git -C "$MAIN" branch -d feat/epic-<id>
git -C "$MAIN" worktree prune
rm -f "$(git -C "$MAIN" rev-parse --path-format=absolute --git-common-dir)/backlog-next-epic-<id>.json"
```

3. **Epic-level postflight** (the full close — this is where checks 4–7 run, deferred from each member):

```bash
node .claude/skills/backlog-next/postflight.mjs --lane=complex --branch=feat/epic-<id> --id=<id>
```

4. Boundary review of `docs/BACKLOG.md` **once** (re-rank LATER, promote, check Parking health) — not per member.

### E9. Resumability

If interrupted, re-invoke `/backlog-next-epic <id>` (add `--auto` to resume unattended). The orchestrator reads run-state + `epic-members.mjs`, re-enters the worktree, and continues at the next open member. Same-epic, same-branch — no duplicate promotion or merge.

## Common mistakes

- **Merging members individually.** The whole point is one branch / one PR per epic. Members commit to `feat/epic-<id>`; only E8 merges, once.
- **Running the expensive e2e per member.** It is hoisted to E6 (epic pre-done) — members run only their cheap mocked integration tests. Running Playwright per member burns AgentCore budget N×.
- **`--auto` auto-resolving a floor decision.** Real-money / prod / force-push / destructive / out-of-repo actions and genuinely-balanced forks ALWAYS pause, `--auto` or not. The decision log is review-after, not a license to act irreversibly unattended.
- **Misfiling required work as captured.** Captured members spin out at close — if one is load-bearing for `done_when`, the E7 audit must promote it to core (else the epic ships with its done-definition silently unmet).
- **Skipping the epic-start preflight or the epic postflight.** Both are hard gates (E0, E8.3). The per-member `--lane=epic-member` gates are lighter on purpose; the branch-scope checks live at the epic boundary.
- **Promoting a second delivery epic.** Rule 11 — one active epic. Resume the in-flight one or finish it first.

## Related

`backlog-next` (the member worker this skill drives in epic-member mode), `backlog-lint`, `backlog-add`, `backlog-themes`, `superpowers:finishing-a-development-branch` / `systematic-debugging` / `brainstorming`. Supporting files: `epic-members.mjs` (+ `test/epic-members.test.mjs`). Design: `docs/superpowers/specs/2026-06-21-backlog-next-epic-orchestrator-design.md`.
