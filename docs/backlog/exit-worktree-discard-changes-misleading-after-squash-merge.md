---
id: exit-worktree-discard-changes-misleading-after-squash-merge
status: parking
type: bug
notes: "ExitWorktree action:remove refuses post-squash-merge cleanup with 'Removing will discard this work permanently' — but the work IS preserved on origin/main as a squash commit. Operator has to override a misleading warning every Complex-lane ship."
references:
  - .claude/skills/backlog-next/SKILL.md
  - .claude/skills/finishing-a-development-branch
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# ExitWorktree's "permanently delete" warning is misleading after a successful squash-merge PR

Surfaced 2026-05-18 during the closing phase of `agent-pipeline-backlog-trap-impl`.

## Evidence

Standard /backlog-next Complex-lane flow:

1. Branch off main in a worktree, accumulate N commits.
2. Open PR, squash-merge via `gh pr merge --squash --delete-branch`.
3. Remote branch deleted; squash commit lands on origin/main with a NEW SHA (different from any of the N worktree commits).
4. Local main fast-forwarded to include the squash commit.
5. Call `ExitWorktree action: "remove"` to clean up the worktree session.
6. ExitWorktree **refuses**: `"Worktree has 13 commits on <branch>. Removing will discard this work permanently. Confirm with the user, then re-invoke with discard_changes: true"`.

This is misleading. The worktree's 13 commits do not exist on the local branch (which is about to be removed) AND are not reachable from local main (squash collapsed them). The *content* is preserved on origin/main as the squash commit — but ExitWorktree's reachability check sees 13 dangling commits and treats them as "work to discard".

The operator (me in this case) has to manually verify the squash commit (`git show <merge-sha>`) and override the warning with `discard_changes: true`. Every Complex-lane ship hits this.

## Why this is a real /backlog-next bug

- The skill's Step 6.7 routes to `finishing-a-development-branch`, which on Option 2 (push+PR) calls ExitWorktree.
- Step 6.8 explicitly mandates the ExitWorktree call ("postflight cannot detect this").
- The "permanently delete" framing trains the operator to disregard safety prompts on routine flows — exactly the failure mode that destroys real work the day a non-squash-merge happens.

## Cheapest next step (when promoted)

ExitWorktree should check whether the worktree's HEAD-tip commit is reachable from any of these:

- The original base ref (e.g. `origin/main`), reachable via cherry-equivalence (`git cherry`) — if every patch on the worktree branch has a cherry-mate on origin/main, the work is preserved even if SHAs differ (squash-merge case).
- A merge commit on origin (e.g. merge-commit case).

If preserved-equivalent, downgrade to an informational notice: "13 commits preserved on origin/main as squash commit <sha>; removing worktree." No `discard_changes: true` required.

If NOT preserved, keep the current refusal.

## Why parking, not queued

- Operator can override with `discard_changes: true` after a quick `git show <squash-sha>` verification.
- Doesn't block any ship.
- Risk is corrosive but slow — repeated "override the warning" trains away the safety value, but no single incident is fatal.

## Related

- [[feedback-worktree-first-no-commits-on-main]] — adjacent friction in the worktree flow.
- `.claude/skills/finishing-a-development-branch` — the skill that invokes ExitWorktree on Option 2.
