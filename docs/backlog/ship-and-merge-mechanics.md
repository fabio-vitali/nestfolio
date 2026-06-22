---
id: ship-and-merge-mechanics
status: shipped
closed: 2026-06-22
type: tooling
notes: "E6/E7/E8 ship+merge are brittle: E8 merge done manually (bypassing finishing-a-development-branch), postflight crashes on the deleted-worktree cwd (skipping the only epic-scope close gate), per-member tests miss cross-member shared-schema breakage, E6 can false-green, and conflict guidance covers only BACKLOG.md."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: "E6/E7/E8 ship+merge hardened on feat/epic-backlog-skills-hardening. F-23: postflight.mjs keeps `git rev-parse --show-toplevel` (the correct per-context root — the WORKTREE for an epic-member run, MAIN for the complex close) but adds a dead-cwd guard (chdir to the script's own live dir before the git call) so it survives being invoked right after the worktree it sat in was removed; callers (epic E8.4, /backlog-next Step 7) cd to a live dir ($MAIN) first as the primary defense. (An initial attempt to derive REPO_ROOT from the git-common-dir parent was reverted — it forced MAIN even for the epic-member lane, which must read the worktree's branch frontmatter; caught by this member's own epic-member postflight.) F-22: already resolved by auto-decision-discipline-and-merge-ownership (E8.1 stops at open PR via AskUserQuestion, agent NEVER runs gh pr merge) — confirmed, no change. F-21: E4.3 gains a cumulative branch typecheck gate (nx run-many -t typecheck over branch-affected) triggered on shared-surface touches (detect-fork-blast-radius); e2e-spec typecheckability is e2e-app tooling → filed out-of-scope as e2e-apps-typecheck-target. F-24: E6 green is now prescriptive — single execution on tip SHA, assert collected-test-count>0 (no zero-test false-green), no split-SHA stitching, e2e.sha pinned for E7 freshness. F-25: E8.1 conflict recipe generalized from BACKLOG.md to ALL docs/backlog/ (incl. epic-file active-vs-shipped, which else rule-11-blocks the next epic) + lint-can't-repair-frontmatter caveat. Gate: full skill suite 105/105 (node --test), backlog-lint 11/11, postflight smoke green. No deploy/e2e (skill scripts/prose)."
epic: backlog-skills-hardening
epic_role: core
---

# E6/E7/E8 ship + merge mechanics

Audit findings F-22, F-23, F-21, F-24, F-25.
See `docs/reviews/2026-06-22-backlog-skills-audit.md` § Cluster 5.

## Root cause

- **F-23 (postflight cwd crash)** — E8.2 removes the worktree, then E8.3 runs
  `postflight.mjs` whose `REPO_ROOT = git rev-parse --show-toplevel` resolves from the now-deleted
  cwd → crash → the only epic-scope close gate (checks 4-7: back-on-main, main-sync, branch-deleted,
  no-stale-worktrees) is **skipped**. Fix at the reusable layer (covers `/backlog-next` Step 7 too):
  resolve `REPO_ROOT` from the git-common-dir parent and run from a guaranteed-live dir.
- **F-22 (manual merge)** — E8.1 says "do not handle the merge manually" but `finishing-a-development-branch`
  Option 2 stops at an *open PR* (it does not merge). The run hand-rolled `gh pr merge` + mergeability
  polling. Per the user-confirmed close behavior (see `auto-decision-discipline-and-merge-ownership`),
  the close should **stop at the open PR — the agent never merges** — so E8.1 must own the
  cleanup-then-handoff sequence, not a merge.
- **F-21 (cross-member type break)** — per-member integration tests don't `tsc` e2e/other-service
  files, so a member renaming a shared contract (WS-3 `quantity→amountCents`) ships green while
  breaking the cumulative branch; it surfaces only at E6. Add a cheap cumulative branch-wide
  typecheck at the member boundary, gated on shared-surface touches, and make e2e specs type-checkable.
- **F-24 (E6 false-green / split-SHA)** — the nx quote-strip foot-gun is only *warned* about (assert
  collected-test-count > 0); a "GREEN" verdict was assembled from 3 runs across 2 SHAs with no
  sanctioned partial-reverify path. Make the green-definition prescriptive (single execution on the
  tip SHA, or a defined re-verify).
- **F-25 (conflict scope)** — E8.1's conflict recipe covers only `docs/BACKLOG.md`, not the epic-file
  active-vs-shipped conflict (main=`active` from E1 vs branch=`shipped` from E7.4) — a wrong
  resolution leaves the epic `active` and rule-11-blocks the next epic. Generalize the recipe to all
  `docs/backlog/` files + flag the lint-can't-repair caveat.

## Done when

Epic postflight runs reliably after worktree removal; E8 close stops at a mergeable open PR with the
worktree cleaned (no manual `gh pr merge`); a shared-contract touch triggers a cumulative branch
typecheck at the member boundary; E6 cannot false-green via zero-collected-tests or a split-SHA
verdict; the conflict recipe covers every machine-regenerated `docs/backlog/` artifact.
