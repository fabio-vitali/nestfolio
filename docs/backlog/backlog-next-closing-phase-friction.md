---
id: backlog-next-closing-phase-friction
status: queued
type: bug
rank: 1
notes: "Two /backlog-next closing-phase UX bugs: (A) postflight tree-clean check passes only by lucky timing when background mutators are active — TWO distinct upstream mutators observed: A.1 jest-worker scratch leak (tmp-<pid>-<rand>/), A.2 Nx daemon socket-dir CWD fallback (<20-hex>/ leaked after each restart). NX_SOCKET_DIR=$TMPDIR sidesteps A.2 entirely. (B) ExitWorktree's 'permanently delete' warning fires routinely after a squash-merge even though the work IS preserved on origin/main."
references:
  - .claude/skills/backlog-next/postflight.mjs
  - .claude/skills/backlog-next/preflight.mjs
  - .claude/skills/finishing-a-development-branch
  - node_modules/nx/src/daemon/tmp-dir.js
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# /backlog-next closing-phase friction — two independent UX bugs

Surfaced 2026-05-18 during the closing phase of `agent-pipeline-backlog-trap-impl`. Both bugs are in the **closing phase** of /backlog-next (skill steps 6.7 + 6.8 + 7) and made the ship feel "almost broken" even though the work itself was fine.

## (A) Postflight tree-clean check is fragile against background mutators

`.claude/skills/backlog-next/postflight.mjs:54-62` requires `git status --porcelain` to be empty. Two distinct upstream mutators have been observed making this gate behave as a slot-machine rather than a hard check. The naming is different (so casual `ls` inspection can't tell them apart) and so are the cleanup levers, but the failure mode at the postflight gate is identical.

### A.1 — jest-worker scratch leak

Observed during the original ship that surfaced this dossier:

1. A 40-day zombie `nx run-many -t test-integration` (PID 48621) was continuously spawning Jest workers — see [[jest-worker-scratch-leak-on-force-exit]] § "2026-05-18 follow-up".
2. Each spawn dumped `tmp-<pid>-<rand>/` dirs that pnpm subsequently injected into `pnpm-lock.yaml` as workspace `importers:` entries.
3. `rm -rf tmp-*` + `git restore pnpm-lock.yaml` cleaned the tree, but the next `postflight.mjs` call arrived after the next worker spawn re-dirtied things.

Identifying signature: `tmp-<pid>-<rand>/` dirs at repo root **plus** spurious `importers:` entries in `pnpm-lock.yaml`. Postflight DOES see these because pnpm-lock changes are tracked.

### A.2 — Nx daemon socket-dir CWD fallback (observed 2026-05-18 PM)

Different upstream, same postflight failure mode, but **invisible to `git status`**:

1. `node_modules/nx/src/daemon/tmp-dir.js:51-55` documents the rule: the daemon tries to bind `<hex>/d.sock` inside `os.tmpdir()`, but on failure falls back to `DAEMON_DIR_FOR_CURRENT_WORKSPACE` (= the repo root). The hex name is intentionally short (20 chars) to stay under macOS' 104-char Unix-socket path limit.
2. The WebStorm `nx-console` plugin periodically wipes `/private/var/folders/.../T/` (line in `daemon.log`: `[NX-CONSOLE]: Cleaning up latest Nx installation from /private/var/folders/.../T/tmp-...`). After that wipe the daemon can no longer bind in `os.tmpdir()` and switches to the CWD fallback for the rest of the session — **permanently** (the fallback decision is not re-evaluated).
3. Each `LOCK_FILES_CHANGED` event (e.g. `pnpm install` during a merge cycle) restarts the daemon. Each restart creates a new `<20-hex>/d.sock` at the repo root, then on exit removes the socket file but **leaves the empty parent dir**. 306 restarts in ~21h → 302 empty hex dirs at repo root in one ship window.
4. Postflight `git status --porcelain` **passes** because git doesn't track empty dirs. The repo *looks* dirty to a human (`ls` shows 302 hex dirs) while git swears it's clean. False-pass, not false-fail.

Identifying signature: empty 20-char hex dirs (`^[0-9a-f]{20}$`) at repo root that match `Started listening on:` socket paths in `.nx/workspace-data/d/daemon.log`. Cross-check command:

```
comm -12 <(ls -1 | grep -E '^[0-9a-f]{20}$' | sort) \
         <(grep -oE "$(pwd | sed 's:/:\\\\/:g')/[0-9a-f]{20}/d\\.sock" .nx/workspace-data/d/daemon.log | \
           sed -E 's:.*/([0-9a-f]{20})/d\.sock:\1:' | sort -u)
```

**Cheapest mitigation for A.2** (operator-level, today):

- `export NX_SOCKET_DIR="$TMPDIR"` in shell/env — bypasses the fallback entirely (`tmp-dir.js:56`: `const dir = process.env.NX_SOCKET_DIR ?? ...`).
- Or `pnpm nx daemon --stop` before any merge-cycle that thrashes the lockfile.

**Cheapest fix for /backlog-next** (when this dossier is promoted):

- Preflight: set `NX_SOCKET_DIR=$TMPDIR` in the env it hands down; `pnpm nx daemon --stop` to guarantee a clean rebind on the next invocation.
- Postflight: in addition to the delta-check below, sweep empty `[0-9a-f]{20}` dirs at repo root (safe — none of them are ever non-empty after a daemon exit).

### Why the gate is fragile regardless of which variant is firing

Net (applies to BOTH variants): postflight passes only on the run where the timing happened to be right (A.1) — or, worse, by being structurally blind to the mutator (A.2: empty dirs are invisible to git). A gate that "passes by accident" is worse than a gate that fails reliably — it gives false confidence that the workstream is closed.

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

## Promotion (2026-05-21)

Promoted from parking at a boundary review — QUEUED was empty after the
`e2e-fixture-agentcore-synchronous-coupling` ship and the user picked this item
directly. The (B) ExitWorktree friction was hit live during that ship's closing
phase: a fast-forward merge left `main` 5 commits ahead of `origin/main`, and
`ExitWorktree action: "remove"` warned it would "discard 5 commits permanently"
even though every commit was reachable from local `main`. The three fixes
(delta-check postflight, `NX_SOCKET_DIR` env in preflight, cherry-equivalent
ExitWorktree downgrade) remain small — but note (B) targets the **ExitWorktree
harness tool**, which is not repo code; scoping must confirm what is actually
fixable from this repository versus what is an upstream harness request.

## Related

- [[jest-worker-scratch-leak-on-force-exit]] — the A.1 upstream mutator.
- `node_modules/nx/src/daemon/tmp-dir.js` — A.2 source-of-truth for the CWD-fallback rule.
- [[feedback-worktree-first-no-commits-on-main]] — adjacent worktree-flow friction.
