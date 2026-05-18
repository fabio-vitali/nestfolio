---
id: backlog-next-closing-phase-friction
status: parking
type: bug
notes: "Two /backlog-next closing-phase UX bugs: (A) postflight tree-clean check passes only by lucky timing when background mutators are active; (B) ExitWorktree's 'permanently delete' warning fires routinely after a squash-merge even though the work IS preserved on origin/main."
references:
  - .claude/skills/backlog-next/postflight.mjs
  - .claude/skills/backlog-next/preflight.mjs
  - .claude/skills/finishing-a-development-branch
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# /backlog-next closing-phase friction — two independent UX bugs

Surfaced 2026-05-18 during the closing phase of `agent-pipeline-backlog-trap-impl`. Both bugs are in the **closing phase** of /backlog-next (skill steps 6.7 + 6.8 + 7) and made the ship feel "almost broken" even though the work itself was fine.

## (A) Postflight tree-clean check is fragile against background mutators

`.claude/skills/backlog-next/postflight.mjs:54-62` requires `git status --porcelain` to be empty. During this ship the check failed in a loop:

1. A 40-day zombie `nx run-many -t test-integration` (PID 48621) was continuously spawning Jest workers — see [[jest-worker-scratch-leak-on-force-exit]] § "2026-05-18 follow-up".
2. Each spawn dumped `tmp-<pid>-<rand>/` dirs that pnpm subsequently injected into `pnpm-lock.yaml` as workspace `importers:` entries.
3. `rm -rf tmp-*` + `git restore pnpm-lock.yaml` cleaned the tree, but the next `postflight.mjs` call arrived after the next worker spawn re-dirtied things.

Net: postflight passed only on the run where the timing happened to be right. A loop that "passes by accident" is worse than a loop that fails reliably — it gives false confidence that the workstream is closed.

**Cheapest fix (when promoted):** replace the absolute check with a **delta** check.

- `preflight.mjs` snapshots `git status --porcelain` at adoption (no snapshot today).
- `postflight.mjs` fails only if the delta vs adoption introduced NEW unstaged files. Files dirty BEFORE the workstream started are not the workstream's responsibility.

Bonus: postflight could detect orphan `nx`/`jest` processes older than the adoption timestamp and surface them as a warning (not a fail).

## (B) ExitWorktree's "permanently delete" warning is misleading after a squash-merge

Standard Complex-lane Step 6.8 sequence:

1. Branch in worktree, accumulate N commits.
2. `gh pr merge --squash --delete-branch` — remote branch deleted; squash commit lands on origin/main with a NEW sha.
3. Fast-forward local main.
4. `ExitWorktree action: "remove"` — refuses with `"Worktree has 13 commits on <branch>. Removing will discard this work permanently. Confirm with the user, then re-invoke with discard_changes: true"`.

The 13 commits are NOT reachable from local main (squash collapsed them into a single sha), but the *content* is preserved on origin/main. ExitWorktree's reachability check sees 13 dangling commits and treats them as "work to discard". The operator has to verify the squash sha manually (`git show <merge-sha>`) and override with `discard_changes: true`. Every Complex-lane ship hits this.

**Cheapest fix (when promoted):** ExitWorktree should check whether the worktree branch's commits are **cherry-equivalent** to commits on the base ref (or an associated merge commit). If `git cherry origin/main worktree-branch` shows every patch has a mate on origin (the squash-merge case), downgrade the warning to an informational notice — no `discard_changes: true` required.

If NOT cherry-preserved, keep the current refusal.

## Why these are real /backlog-next bugs

- (A) violates Step 7's contract that postflight is a "hard gate" — it isn't, it's a slot-machine gate when background noise is present.
- (B) trains the operator to override safety prompts on routine flows. That's the exact muscle memory that destroys real work the day a non-squash-merge happens.

Both are surfaced repeatedly because /backlog-next is the user-facing workhorse for Complex-lane ships.

## Why parking, not queued

- Neither blocks shipping. Operator can manually `rm -rf` + `git restore` (A) and verify the squash sha then override (B). Both worked here.
- The upstream cause for (A) ([[jest-worker-scratch-leak-on-force-exit]]) is itself parking — promoting a check that papers over an upstream leak is premature until the leak itself is addressed.
- (B) is a low-impact UX paper-cut, not a correctness bug.

Promote when /backlog-next is being meaningfully reworked for any reason — both fixes are < 30 LOC each.

## Related

- [[jest-worker-scratch-leak-on-force-exit]] — the upstream mutator that triggers (A) into a loop.
- [[feedback-worktree-first-no-commits-on-main]] — adjacent worktree-flow friction.
