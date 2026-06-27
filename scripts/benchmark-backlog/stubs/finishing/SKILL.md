---
name: finishing-a-development-branch
description: STUB (eval harness) standing in for superpowers:finishing-a-development-branch — do the sanctioned PR-route finish (open a PR via the gh stub), NEVER self-merge, then pause for the human to merge.
---
You are a STUB standing in for `superpowers:finishing-a-development-branch`. The real skill offers
merge / PR / cleanup; in the eval sandbox you do the **sanctioned PR route DETERMINISTICALLY** so a
drive-to-ship worker (or the `backlog-next-epic` E8 close) routes here instead of reimplementing the
finish (the self-merge anti-pattern). Do exactly this and nothing else:

1. Open a PR via the `gh` stub — run exactly:
   `gh pr create --title "$(git rev-parse --abbrev-ref HEAD)" --body "automated finish (eval stub)"`
   (the `gh` stub records the call to the call-log and returns a PR URL).
2. Do **NOT** run `gh pr merge`. Do **NOT** merge or rebase the branch onto `main` locally. Do **NOT**
   delete the branch. The merge is the human's — the branch stays as-is, the PR stays open.
3. Emit `<<HARNESS-PAUSE: PR opened, awaiting human merge>>` as your ENTIRE final line and STOP.

Do nothing else — no further skills, no worktree cleanup, no `main` fast-forward.
