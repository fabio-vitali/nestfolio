# `/backlog-next` closing-phase friction fixes

- **Date:** 2026-05-21
- **Backlog:** `backlog-next-closing-phase-friction`
- **Type:** bug (skill tooling)

## Problem

Two independent UX bugs in the `/backlog-next` closing phase, both surfaced
repeatedly because `/backlog-next` is the Complex-lane workhorse.

### (A) Postflight tree-clean check is fragile against background mutators

`.claude/skills/backlog-next/postflight.mjs:54-62` fails unless
`git status --porcelain` is empty. Two background mutators interfere:

- **A.1 — jest-worker scratch leak.** Orphan `nx`/`jest` processes (a 40-day
  zombie was observed) continuously spawn workers that drop `tmp-<pid>-<rand>/`
  dirs and pollute `pnpm-lock.yaml` with `tmp-*` `importers:` entries.
  `pnpm-lock.yaml` is tracked, so postflight **fails** on it.
- **A.2 — Nx daemon socket-dir CWD fallback.** When the daemon cannot bind in
  `os.tmpdir()` it falls back to the repo root, leaving an empty
  `[0-9a-f]{20}/` dir after every restart (302 observed in one ship window).

**Code-verified scope correction:** of the litter the dossier lists, only some
reaches `git status --porcelain`. `cdk.out*/` and `jest_dx/` are already
gitignored (jest-worker stopgap, 2026-05-15); empty `[0-9a-f]{20}/` hex dirs are
invisible to git, which does not track empty directories. So:

- The genuine postflight **false-fail** is `pnpm-lock.yaml` pollution plus any
  non-empty `tmp-*/` dirs (A.1).
- The empty hex dirs (A.2) are a cosmetic **litter** problem — the repo root
  *looks* dirty to a human while git reports clean. Not a gate failure.

### (B) ExitWorktree "permanently delete" warning after a clean merge

After a fast-forward or squash merge, `ExitWorktree action: "remove"` warns it
will "discard N commits permanently" — the commits are not reachable as a
distinct branch tip, though their content is on `main`. Confirmed live during
the `e2e-fixture-agentcore-synchronous-coupling` ship: a FF-merge left the
branch with 5 commits ExitWorktree flagged for discard, all of them already on
`main`. The operator must override with `discard_changes: true` on every
Complex-lane ship — training the exact muscle memory that destroys real work
the day a non-merged branch is removed.

**Constraint:** `ExitWorktree` is a Claude Code **harness tool**. Its code is not
in this repository and cannot be edited here. The dossier's literal (B) fix
(cherry-equivalence check inside ExitWorktree) is an upstream harness request.

## Approach

Decided with the user at brainstorming:

- **(A): delta-check + daemon-stop + sweep.** Full robustness bundle.
- **(B): SKILL.md guidance note.** The only repo-side lever; the harness-tool
  change is recorded as an upstream request.

## Detailed design

### Component 1 — `preflight.mjs`: snapshot + daemon-stop

`preflight.mjs` keeps all four existing hard checks unchanged (tree-clean,
main-not-ahead, backlog-lint, stale-worktrees). After the checks pass, before
the success message:

1. **Write a snapshot.** Resolve the git common dir
   (`git rev-parse --git-common-dir`) and write
   `<git-common-dir>/backlog-next-snapshot.json`:

   ```json
   { "timestamp": "<ISO-8601>", "status": "<git status --porcelain output>" }
   ```

   Storing inside the git dir means the file is inherently untracked — no
   `.gitignore` entry needed, and it never appears in `git status`. Because
   preflight already hard-fails on a dirty tree, `status` is normally empty;
   it is captured anyway so the mechanism still holds if that gate is ever
   relaxed.

2. **Stop the Nx daemon.** Run `pnpm nx daemon --stop` best-effort, wrapped in
   the existing `shSafe` helper so a failure never fails preflight. A fresh
   daemon on the next `nx` invocation rebinds its socket cleanly, reducing A.2
   generation during the workstream.

If preflight fails, neither step runs (no workstream is starting).

### Component 2 — `postflight.mjs`: classify, sweep, warn

Replace the absolute tree-clean check (current lines 54-62) with a classifier.

**Litter patterns** (repo-root basename regexes, background-tool ephemera):

- `^tmp-\d+-[a-z0-9]+$` — jest-worker scratch dirs
- `^nx-native-file-cache-[0-9a-f]+$` — Nx native cache
- `^node-compile-cache$` — Node compile cache
- `^[0-9a-f]{20}$` — empty Nx-daemon socket dirs (A.2)

**Snapshot load.** Read `<git-common-dir>/backlog-next-snapshot.json`. If absent
(preflight skipped, e.g. resumed ACTIVE workstream), treat the snapshot status
as empty and skip the orphan-process age check — degrade gracefully, never
crash.

**Classification.** For each `git status --porcelain` entry, take the path's
repo-root-relative first segment:

- First segment matches a litter pattern → **litter** (not a failure).
- Exact entry present in the snapshot `status` → **pre-existing** (not a
  failure — dirty before the workstream, not its responsibility).
- Otherwise → **genuine** uncommitted workstream change → collected as a
  failure with the same `tree-clean` severity as today.

**Sweep.** The sweep is a direct `readdir` of the repo root — **not** driven by
`git status` — because the empty hex dirs (A.2) never appear in
`git status --porcelain` at all. For each repo-root directory entry whose
basename matches a litter pattern, remove it: empty `[0-9a-f]{20}/` dirs only
when empty (provably safe — a daemon removes its socket on exit, leaving the dir
empty), and `tmp-*` / `nx-native-file-cache-*` / `node-compile-cache` dirs
unconditionally (background-tool ephemera with no workstream value). The sweep
only ever removes directories whose basename matches a litter pattern; it never
touches tracked files. `pnpm-lock.yaml` is never auto-restored — a polluted
lockfile stays a hard failure (it is the separate
`nx-daemon-self-upgrade-pollutes-pnpm-lock` item's concern).

Sweep ordering: run the sweep **before** the classification's final pass/fail
decision, so litter dirs that *do* surface in `git status` (non-empty `tmp-*`)
are removed and do not need to rely on the classifier alone.

**Orphan-process warning.** If the snapshot has a timestamp, run
`ps -A -o lstart,pid,command`, find `nx`/`jest` processes started before that
timestamp, and print them as a **warning** — never a failure. A stale runner is
the A.1 root cause; surfacing it helps the operator without blocking the ship.

**Failure semantics unchanged.** Genuine uncommitted changes still fail
postflight with exit 1. Only litter and pre-existing dirt are newly excused.

### Component 3 — `SKILL.md`: step 6.8 note for (B)

Add a short paragraph to `.claude/skills/backlog-next/SKILL.md` step 6.8:

> After a fast-forward or squash merge, `ExitWorktree action: "remove"` warns it
> will "discard N commits permanently". This is expected — the worktree branch's
> commits are not reachable as a distinct branch tip, but their content is on
> `main`. Verify with `git merge-base --is-ancestor <branch> main` (exit 0 = safe),
> then re-invoke with `discard_changes: true`. The cherry-equivalence downgrade
> belongs in the ExitWorktree harness tool and is filed as an upstream request.

### Files

- `.claude/skills/backlog-next/preflight.mjs` — snapshot write + daemon-stop.
- `.claude/skills/backlog-next/postflight.mjs` — classifier replacing the
  absolute check, sweep, orphan warning.
- `.claude/skills/backlog-next/SKILL.md` — step 6.8 (B) note.

The litter-pattern list is small and lives inline in `postflight.mjs`; a
shared module is not warranted (preflight does not classify).

## Testing & validation

The skill scripts are not in the Nx test graph — there is no unit-test target
for `.mjs` skill tooling. Validation is scenario-based:

1. **Sweep scenario.** Create a synthetic empty `0123456789abcdef0123/` hex dir
   and a `tmp-9999-zz/` dir at the repo root, run `postflight.mjs`, confirm both
   are swept and postflight still passes.
2. **Genuine-failure scenario.** Create an untracked `docs/scratch-real.md`, run
   `postflight.mjs`, confirm it still **fails** with the `tree-clean` rule.
3. **Pre-existing scenario.** With a snapshot whose `status` lists a path,
   confirm postflight excuses that exact path.
4. **Dogfooding.** This workstream's own closing phase runs the modified
   `preflight.mjs` (already run at adoption — unmodified then) and
   `postflight.mjs`; a clean pass there is part of the validation gate.

No deploy — skill tooling only, Tier 0.

## Out of scope

- Editing the `ExitWorktree` harness tool itself — not repo code. (B) is
  addressed only via the SKILL.md note; the tool change is an upstream request.
- Fixing the jest-worker scratch leak at its source (`forceExit: true` in
  `nx.json`) — the separately-queued `jest-worker-scratch-leak-on-force-exit`
  workstream (rank 2). This workstream hardens the postflight *gate*, it does
  not remove the *leak*.
- Changing the Nx daemon CWD-fallback behaviour inside `node_modules/nx`.
- Auto-restoring or de-polluting `pnpm-lock.yaml` — the
  `nx-daemon-self-upgrade-pollutes-pnpm-lock` item's concern.
- Supervising or killing orphan `nx`/`jest` processes — postflight only warns.
- Adding `tmp-*/` to `.gitignore` — postflight classifies litter at check time
  without hiding it from git globally.
