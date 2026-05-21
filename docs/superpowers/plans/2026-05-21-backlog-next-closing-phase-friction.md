# `/backlog-next` closing-phase friction fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/backlog-next`'s postflight gate robust against background-tool litter, stop the Nx daemon at preflight to reduce that litter, and document the expected ExitWorktree warning.

**Architecture:** `preflight.mjs` persists a git-status snapshot (in the git common dir, inherently untracked) and best-effort stops the Nx daemon. `postflight.mjs` replaces its absolute tree-clean check with a classifier that excuses pre-existing dirt and known background-tool litter, sweeps litter directories from the repo root, and warns (never fails) on orphan runners. `SKILL.md` step 6.8 gains a note explaining the expected post-merge ExitWorktree warning.

**Tech Stack:** Node.js ES modules (`.mjs`), `node:child_process`, `node:fs`, git plumbing.

**Spec:** `docs/superpowers/specs/2026-05-21-backlog-next-closing-phase-friction-design.md`

---

### Task 1: `preflight.mjs` — snapshot + daemon-stop

**Files:**
- Modify: `.claude/skills/backlog-next/preflight.mjs` (imports line 17; success block near line 135)

- [ ] **Step 1: Add `writeFileSync` to the fs import**

In `.claude/skills/backlog-next/preflight.mjs`, change line 17:

```js
import { existsSync } from 'node:fs';
```

to:

```js
import { existsSync, writeFileSync } from 'node:fs';
```

- [ ] **Step 2: Write the snapshot + stop the daemon on success**

The file currently ends with the report block and a final success
`console.log`. Replace the final success line:

```js
console.log('✓ Preflight passed: tree clean, main = origin/main, backlog-lint green, no stale worktrees.');
```

with:

```js
// 5. On success only: persist a git-status snapshot for postflight's
// delta-check, and stop the Nx daemon so its next start rebinds a clean
// socket (mitigates the daemon CWD-fallback hex-dir leak).
const snapshotPath = join(
  sh('git rev-parse --path-format=absolute --git-common-dir'),
  'backlog-next-snapshot.json',
);
writeFileSync(
  snapshotPath,
  JSON.stringify({ timestamp: new Date().toISOString(), status }, null, 2),
);

shSafe('pnpm nx daemon --stop');

console.log('✓ Preflight passed: tree clean, main = origin/main, backlog-lint green, no stale worktrees.');
```

`status` is the existing `git status --porcelain` capture from line 34 — in
scope here. `join` and `shSafe` are already imported / defined.

- [ ] **Step 3: Verify preflight still passes and writes the snapshot**

Run: `node .claude/skills/backlog-next/preflight.mjs && cat "$(git rev-parse --path-format=absolute --git-common-dir)/backlog-next-snapshot.json"`
Expected: the `✓ Preflight passed` line, then a JSON object with `timestamp`
and `status` keys (`status` empty if the tree is clean).

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/backlog-next/preflight.mjs
git commit -m "fix(backlog-next): preflight persists status snapshot + stops nx daemon"
```

---

### Task 2: `postflight.mjs` — classifier, sweep, orphan warning

**Files:**
- Modify: `.claude/skills/backlog-next/postflight.mjs` (imports line 25; tree-clean check lines 54-62; report block lines 180-192)

- [ ] **Step 1: Extend the fs import**

In `.claude/skills/backlog-next/postflight.mjs`, change line 25:

```js
import { existsSync, readFileSync } from 'node:fs';
```

to:

```js
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
```

- [ ] **Step 2: Replace the absolute tree-clean check with the classifier**

Replace the current check 1 block (lines 54-62):

```js
// 1. Tree clean
const status = sh('git status --porcelain');
if (status.length > 0) {
  failures.push({
    rule: 'tree-clean',
    message: 'Working tree is dirty. Commit or revert before declaring the workstream done.',
    detail: status,
  });
}
```

with:

```js
// 1. Tree clean — delta-aware. Excuses dirt that (a) existed at preflight or
// (b) is known background-tool litter; sweeps litter dirs from the repo root.
const LITTER_PATTERNS = [
  /^tmp-\d+-[a-z0-9]+$/,
  /^nx-native-file-cache-[0-9a-f]+$/,
  /^node-compile-cache$/,
];
const HEX_DIR = /^[0-9a-f]{20}$/;

// Sweep repo-root litter dirs (direct readdir — empty hex dirs never appear in
// `git status`). Empty hex dirs are removed only when empty; other litter dirs
// unconditionally. Only ever removes directories whose basename matches a
// litter pattern — never touches tracked files.
const swept = [];
for (const name of readdirSync(REPO_ROOT)) {
  const full = join(REPO_ROOT, name);
  let isDir = false;
  try { isDir = statSync(full).isDirectory(); } catch { continue; }
  if (!isDir) continue;
  if (HEX_DIR.test(name)) {
    let empty = false;
    try { empty = readdirSync(full).length === 0; } catch { empty = false; }
    if (empty) { rmSync(full, { recursive: true, force: true }); swept.push(name); }
  } else if (LITTER_PATTERNS.some((re) => re.test(name))) {
    rmSync(full, { recursive: true, force: true });
    swept.push(name);
  }
}

// Load the preflight snapshot (graceful if absent — e.g. resumed workstream).
let snapshot = { timestamp: null, status: '' };
const snapshotPath = join(
  sh('git rev-parse --path-format=absolute --git-common-dir'),
  'backlog-next-snapshot.json',
);
if (existsSync(snapshotPath)) {
  try { snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')); }
  catch { /* corrupt snapshot — fall back to empty */ }
}
const snapshotEntries = new Set(
  String(snapshot.status || '').split('\n').map((l) => l.trim()).filter(Boolean),
);

// Classify remaining dirt.
const status = sh('git status --porcelain');
const genuine = [];
for (const line of status.split('\n').filter(Boolean)) {
  if (snapshotEntries.has(line.trim())) continue;            // pre-existing
  const firstSegment = line.slice(3).split('/')[0];          // porcelain: "XY path"
  if (LITTER_PATTERNS.some((re) => re.test(firstSegment)) || HEX_DIR.test(firstSegment)) {
    continue;                                                // background-tool litter
  }
  genuine.push(line);
}
if (genuine.length > 0) {
  failures.push({
    rule: 'tree-clean',
    message: 'Working tree has uncommitted workstream changes. Commit or revert before declaring the workstream done.',
    detail: genuine.join('\n'),
  });
}

// Orphan-runner warning (never a failure): nx/jest processes older than the
// snapshot timestamp are a likely litter source — surface, do not block.
const warnings = [];
if (snapshot.timestamp) {
  const snapMs = Date.parse(snapshot.timestamp);
  const ps = shSafe('ps -A -o lstart=,pid=,command=');
  if (ps.ok && !Number.isNaN(snapMs)) {
    for (const line of ps.out.split('\n')) {
      if (!/(nx|jest)/.test(line)) continue;
      const started = Date.parse(line.slice(0, 24));         // lstart is 24-char ctime
      if (!Number.isNaN(started) && started < snapMs) warnings.push(line.trim());
    }
  }
}
```

- [ ] **Step 3: Surface swept dirs and warnings in the report**

In the report section, change the success path. Replace the final lines
(currently the `if (failures.length > 0) { ... }` block followed by the
success `console.log`) so the swept/warning info prints regardless of
pass/fail. Insert this block immediately BEFORE the `if (failures.length > 0)`
line:

```js
// Informational output (prints whether or not the gate passes).
if (swept.length > 0) {
  console.log(`  swept ${swept.length} background-litter dir(s) from repo root: ${swept.join(', ')}`);
}
for (const w of warnings) {
  console.warn(`  ⚠ orphan nx/jest process predates this workstream (likely litter source): ${w}`);
}
```

Leave the existing `if (failures.length > 0) { ... process.exit(1); }` block
and the final `console.log('✓ Postflight passed ...')` unchanged.

- [ ] **Step 4: Verify the classifier — sweep + pass scenario**

```bash
mkdir -p 0123456789abcdef0123 tmp-9999-zz/sub
node .claude/skills/backlog-next/postflight.mjs --lane=simple
ls -d 0123456789abcdef0123 tmp-9999-zz 2>/dev/null || echo "both swept"
```
Expected: postflight reports `swept 2 background-litter dir(s)` and prints
`✓ Postflight passed`; the final `ls` prints `both swept`.

- [ ] **Step 5: Verify the classifier — genuine-failure scenario**

```bash
echo scratch > docs/scratch-real-postflight-test.md
node .claude/skills/backlog-next/postflight.mjs --lane=simple; echo "exit=$?"
rm docs/scratch-real-postflight-test.md
```
Expected: postflight FAILS with `[tree-clean]` listing
`docs/scratch-real-postflight-test.md`, `exit=1`.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/backlog-next/postflight.mjs
git commit -m "fix(backlog-next): postflight classifies litter, sweeps, warns on orphans"
```

---

### Task 3: `SKILL.md` — step 6.8 ExitWorktree note

**Files:**
- Modify: `.claude/skills/backlog-next/SKILL.md` (step 6.8 paragraph)

- [ ] **Step 1: Append the ExitWorktree note to step 6.8**

Locate the `**6.8 Complex lane only — exit the worktree session.**` paragraph
in `.claude/skills/backlog-next/SKILL.md`. Immediately after that paragraph
(before the `### 7. Postflight` heading), insert this new paragraph:

```markdown
**Expected ExitWorktree warning after a clean merge.** Once `finishing-a-development-branch` has fast-forward- or squash-merged the feature branch into `main`, `ExitWorktree action: "remove"` warns it will "discard N commits permanently". This is expected: the worktree branch's commits are not reachable as a distinct branch tip, but their content is on `main`. Verify it is safe with `git merge-base --is-ancestor <feature-branch> main` (exit 0 ⇒ every branch commit is an ancestor of `main`), then re-invoke `ExitWorktree` with `discard_changes: true`. Do NOT treat the warning as a sign of lost work. A cherry-equivalence check that would downgrade this to an informational notice belongs in the `ExitWorktree` harness tool itself (not repo code) and is filed as an upstream request.
```

- [ ] **Step 2: Verify the note is well-formed**

Run: `grep -n "Expected ExitWorktree warning" .claude/skills/backlog-next/SKILL.md`
Expected: one match, inside section 6, before `### 7. Postflight`.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/backlog-next/SKILL.md
git commit -m "docs(backlog-next): note expected ExitWorktree warning in step 6.8"
```

---

### Task 4: Full-scenario validation

No code change — runs the spec's validation scenarios end to end. The skill
scripts are not in the Nx test graph, so this is the validation gate.

**Files:** none modified.

- [ ] **Step 1: Pre-existing-dirt scenario**

Confirm a path listed in the snapshot is excused:

```bash
SNAP="$(git rev-parse --path-format=absolute --git-common-dir)/backlog-next-snapshot.json"
node -e "const f=process.argv[1];require('fs').writeFileSync(f,JSON.stringify({timestamp:new Date().toISOString(),status:' M docs/BACKLOG.md'}))" "$SNAP"
echo "x" >> docs/BACKLOG.md
node .claude/skills/backlog-next/postflight.mjs --lane=simple; echo "exit=$?"
git checkout docs/BACKLOG.md
rm -f "$SNAP"
```
Expected: postflight does NOT fail on `docs/BACKLOG.md` (it is in the snapshot);
`exit=0` assuming no other genuine dirt. `rm -f "$SNAP"` removes the synthetic
snapshot so the real closing-phase postflight runs against a genuine (absent →
graceful) snapshot — preflight cannot regenerate it from inside the worktree
(its `not-on-main` gate fails there by design).

- [ ] **Step 2: Confirm the working tree is clean**

Run: `git status --porcelain`
Expected: empty — none of the scenario scaffolding leaked.

- [ ] **Step 3: No commit** — validation only. Evidence is recorded in the
backlog file's `validation_gate:` during the `/backlog-next` closing phase.

---

## Out of scope

- Editing the `ExitWorktree` harness tool — not repo code.
- The jest-worker `forceExit` leak source — separate workstream `jest-worker-scratch-leak-on-force-exit`.
- Nx daemon CWD-fallback behaviour inside `node_modules/nx`.
- Auto-restoring `pnpm-lock.yaml` — `nx-daemon-self-upgrade-pollutes-pnpm-lock`.
- `.gitignore` changes for `tmp-*/`.
