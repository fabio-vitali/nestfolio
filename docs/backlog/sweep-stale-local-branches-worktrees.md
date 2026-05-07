---
id: sweep-stale-local-branches-worktrees
status: parking
type: tooling
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "16 unmerged feat/refactor branches + 2 worktrees; ~15 min chore."
---

# Sweep stale local branches + unused worktrees

As of 2026-05-02 the local clone has 16 unmerged-named `feat/` `refactor/` `docs/` branches plus 2 worktrees (`.worktrees/ledger-domain` for `feature/ledger-domain-restructure` at `079f005b`, `.worktrees/playwright-e2e` for `feat/playwright-e2e-ui` at `20971554`). Most appear shipped per MEMORY.md "Recently Completed Work" (a2-frontend-deps, b1-cloudfront, b2-federation, b4-shell, c-cleanup-and-playwright, d-mfe-deploy, f-loadmfe, g-feature-flags, agentcore-transport, integration-test-resilience, real-money-ops, etc.) but `git branch -d` may refuse if they're squash-merged or rebased (not direct ancestors of `main`). For each branch: cross-check against MEMORY.md / `git log` on main for the corresponding ship commit, then `git branch -D` if confirmed shipped, or `git rebase main && git branch -d` if cleanly forward. For worktrees: `git worktree remove .worktrees/<name>` after confirming no uncommitted work in each. Sole-dev project — no risk of stomping a teammate. ~15 min chore. Promote when the long branch list becomes friction (tab-completion noise, accidental checkout of a stale branch).
