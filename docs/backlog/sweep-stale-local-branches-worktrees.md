---
id: sweep-stale-local-branches-worktrees
status: shipped
type: tooling
references: []
out_of_scope:
  - "Pushing branch deletions to origin (these are local-only sweeps; if a branch exists on origin it stays until a separate explicit decision)."
  - "Deleting branches with uncommitted work or unique commits not represented on main — those get kept and reported."
  - "Touching the current branch (main) or any branch with a checked-out worktree that has dirty state."
spec: null
plan: null
topic_memory: []
validation_gate: "`git branch -v` post-sweep shows only `* main`. `git worktree list` shows only the primary worktree. All 16 branches were verified as linear-history ancestors of `main` via `git merge-base --is-ancestor` before deletion; 15 deleted via safe `-d`, 1 (`feat/b2-federation-mechanical-fixes`) force-deleted with `-D` after ancestry re-verification because its local tip diverged from origin tracking ref (3 commits ahead on the local side, all of which are reachable from main). Untracked `.worktrees/ledger-domain/plans/fixes07.md` backed up to `/tmp/sweep-stale-backup-2026-05-12/` before worktree removal."
notes: "16 unmerged feat/refactor branches + 2 worktrees; ~15 min chore."
---

# Sweep stale local branches + unused worktrees

As of 2026-05-02 the local clone has 16 unmerged-named `feat/` `refactor/` `docs/` branches plus 2 worktrees (`.worktrees/ledger-domain` for `feature/ledger-domain-restructure` at `079f005b`, `.worktrees/playwright-e2e` for `feat/playwright-e2e-ui` at `20971554`). Most appear shipped per MEMORY.md "Recently Completed Work" (a2-frontend-deps, b1-cloudfront, b2-federation, b4-shell, c-cleanup-and-playwright, d-mfe-deploy, f-loadmfe, g-feature-flags, agentcore-transport, integration-test-resilience, real-money-ops, etc.) but `git branch -d` may refuse if they're squash-merged or rebased (not direct ancestors of `main`). For each branch: cross-check against MEMORY.md / `git log` on main for the corresponding ship commit, then `git branch -D` if confirmed shipped, or `git rebase main && git branch -d` if cleanly forward. For worktrees: `git worktree remove .worktrees/<name>` after confirming no uncommitted work in each. Sole-dev project — no risk of stomping a teammate. ~15 min chore. Promote when the long branch list becomes friction (tab-completion noise, accidental checkout of a stale branch).

## Ship notes

SHIPPED 2026-05-12. Outcome was cleaner than the dossier predicted: every single one of the 16 branches turned out to be a linear-history ancestor of `main` (verified upfront via `git merge-base --is-ancestor` for each), so no squash-merge / rebase forensics was needed. 15 deleted via safe `git branch -d`. The only outlier was `feat/b2-federation-mechanical-fixes` — its local tip (`17723ed8`) diverged from its origin tracking ref by 3 commits, all of which were reachable from main; force-deleted with `-D` after re-confirming ancestry.

Worktree handling: `playwright-e2e` was completely clean and removed cleanly. `ledger-domain` had one untracked file (`plans/fixes07.md`, a 2-month-old code-review scratch for the already-shipped ledger-domain-restructure design — referenced specs/plans no longer on main, indicating they were intentionally cleaned up at ship). File backed up to `/tmp/sweep-stale-backup-2026-05-12/fixes07.md` as a safety net and worktree removed with `--force`. The `.worktrees/` parent directory was empty after removal and was rmdir'd.

Post-sweep state: `git branch -v` shows only `* main`; `git worktree list` shows only the primary worktree.
