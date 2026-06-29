# Backlog skills: procedure → tested helpers (γ) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract three load-bearing multi-step bash dances from `backlog-next` + `backlog-next-epic` SKILL.md prose into three tested `.mjs` helpers, preserving behavior and the benchmark compare-observability invariant.

**Architecture:** Each helper follows the established pure-core + thin-CLI pattern (`epic-members.mjs`, `runstate.mjs`, `detect-fork-blast-radius.mjs`): a pure named-export decision function operating on plain data, plus a `main()` that does argv → git/fs gather → call pure fn → format stdout → `process.exit`. All side effects shell out **only** to `git` and `node lint.mjs` — both run-for-real / end-state-graded by the harness — so extraction grades identically to the prose. No helper touches `gh`/`deploy.sh`/`nx`/`backlog-next-worker` (the four PATH-shim stubs); where the resume gate needs PR state it runs `gh pr view <branch>` in `main()` (keeping `gh` observable) and injects the result into the pure core.

**Tech Stack:** Node 24 ESM (`.mjs`), `node:test` + `node:assert/strict`, `node:child_process` `execSync`, `node:fs`. Tests run via the glob form `node --test <skill>/test/*.test.mjs`.

## Global Constraints

- Helpers live in `.claude/skills/backlog-next-epic/`; `worktree-ops.mjs` is also invoked by `backlog-next` SKILL.md (one helper, two callers — referenced by skill-relative path, exactly as `backlog-next-epic` already calls `backlog-next/preflight.mjs`).
- Every helper: `#!/usr/bin/env node` shebang, JSDoc header documenting **Usage** + **Exit codes** verbatim, all **named exports** (no default exports), main-guard `if (import.meta.url === \`file://${process.argv[1]}\` || fileURLToPath(import.meta.url) === process.argv[1]) main();`.
- Exit-code grammar (copy from existing helpers): `0` = success / affirmative; `1` = error / escalate-to-floor; `2` = usage / malformed; `10` = no-op (only where a "detect" gate needs it — none here); `3` = absent (runstate only).
- Side effects shell out **only** to `git` and `node lint.mjs`. **NEVER** `gh`/`deploy.sh`/`nx`/`backlog-next-worker` inside a helper core. (resume-gate's `gh pr view` lives in `main()`, observable, result injected to the pure core.)
- Behavior-preserving: characterization tests pin CURRENT behavior; no procedure changes its observable effect.
- Tests import the pure functions directly — never spawn the CLI via child_process.
- Use `sh`/`shSafe` closures for git calls; `shSafe` (never throws, returns `{ok,out,err,code}`) for any command allowed to fail.
- Resolve MAIN (the primary worktree root) via the git-common-dir parent, robust to a dead cwd — never assume cwd is MAIN (it is often the worktree being removed).

---

### Task 1: `resume-gate.mjs` — pure resume dispatch

**Files:**
- Create: `.claude/skills/backlog-next-epic/resume-gate.mjs`
- Test: `.claude/skills/backlog-next-epic/test/resume-gate.test.mjs`

**Interfaces:**
- Consumes: nothing from other tasks. At runtime `main()` shells `node runstate.mjs get <id>` and (only when `e8` set) `gh pr view <branch> --json state -q .state`.
- Produces: `export const RESUME_ACTIONS`; `export function decideResume({ runState, prState }) → { action, reason }` with `action ∈ {FRESH, RESUME, POST_MERGE_TAIL, PR_STILL_OPEN, ERROR}`. `runState` is `{kind:'absent'} | {kind:'malformed', error} | {kind:'present', state}`. `prState` is the injected `gh pr view` result string, consulted only when `state.e8 === 'PR_OPEN_AWAITING_MERGE'`.

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/backlog-next-epic/test/resume-gate.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideResume, RESUME_ACTIONS } from '../resume-gate.mjs';

const present = (state) => ({ kind: 'present', state });

test('absent run-state → FRESH', () => {
  assert.equal(decideResume({ runState: { kind: 'absent' } }).action, 'FRESH');
  assert.equal(decideResume({}).action, 'FRESH'); // undefined runState defaults to FRESH
});

test('present run-state, no e8 → RESUME (re-enter member loop)', () => {
  assert.equal(decideResume({ runState: present({ branch: 'feat/epic-x' }) }).action, 'RESUME');
});

test('e8 set + PR MERGED → POST_MERGE_TAIL', () => {
  const runState = present({ branch: 'feat/epic-x', e8: 'PR_OPEN_AWAITING_MERGE' });
  assert.equal(decideResume({ runState, prState: 'MERGED' }).action, 'POST_MERGE_TAIL');
});

test('e8 set + PR OPEN → PR_STILL_OPEN (re-print, stop)', () => {
  const runState = present({ branch: 'feat/epic-x', e8: 'PR_OPEN_AWAITING_MERGE' });
  assert.equal(decideResume({ runState, prState: 'OPEN' }).action, 'PR_STILL_OPEN');
});

test('e8 set + PR state unknown/absent → PR_STILL_OPEN (safe: never auto-tail unconfirmed)', () => {
  const runState = present({ branch: 'feat/epic-x', e8: 'PR_OPEN_AWAITING_MERGE' });
  assert.equal(decideResume({ runState }).action, 'PR_STILL_OPEN');
  assert.equal(decideResume({ runState, prState: 'CLOSED' }).action, 'PR_STILL_OPEN');
});

test('malformed run-state → ERROR with clean message (F-11/F-13)', () => {
  const r = decideResume({ runState: { kind: 'malformed', error: 'bad json at line 3' } });
  assert.equal(r.action, 'ERROR');
  assert.match(r.reason, /bad json/);
});

test('RESUME_ACTIONS lists exactly the five actions', () => {
  assert.deepEqual([...RESUME_ACTIONS].sort(), ['ERROR', 'FRESH', 'POST_MERGE_TAIL', 'PR_STILL_OPEN', 'RESUME'].sort());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/backlog-next-epic/test/resume-gate.test.mjs`
Expected: FAIL — `Cannot find module '../resume-gate.mjs'`.

- [ ] **Step 3: Write minimal implementation**

Create `.claude/skills/backlog-next-epic/resume-gate.mjs`:

```js
#!/usr/bin/env node
/**
 * Resume-gate dispatch for /backlog-next-epic (top of Procedure).
 *
 * Decides how a `/backlog-next-epic <id>` invocation proceeds, from the durable
 * run-state and — ONLY when the e8 hand-off marker is set — the PR state. The
 * decision is PURE (decideResume); main() does the impure gather: it runs
 * `runstate.mjs get` and, only if e8 is set, `gh pr view <branch> --json state`
 * (shelled out so the benchmark gh PATH-shim stays observable; the result is
 * INJECTED into the pure core, never fetched inside it).
 *
 * Actions:
 *   FRESH           — no run-state → run E0→E1→E2→E3→E4 (promote + fresh worktree)
 *   RESUME          — run-state present, no e8 → re-enter worktree, jump to E4 loop
 *   POST_MERGE_TAIL — e8 set AND PR merged → run only the E8.4 tail
 *   PR_STILL_OPEN   — e8 set AND PR not confirmed-merged → re-print link, STOP
 *   ERROR           — malformed run-state → clean message (never a raw stack)
 *
 * Usage: node resume-gate.mjs <epic-id>
 * Exit codes: 0 ok (prints `action=<X>`) · 2 malformed/usage (ERROR action).
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const RESUME_ACTIONS = ['FRESH', 'RESUME', 'POST_MERGE_TAIL', 'PR_STILL_OPEN', 'ERROR'];
const E8_MARKER = 'PR_OPEN_AWAITING_MERGE';

/** Pure dispatch — see file header for the input/output contract. */
export function decideResume({ runState, prState } = {}) {
  if (!runState || runState.kind === 'absent') {
    return { action: 'FRESH', reason: 'no run-state — fresh epic run (E0→E4)' };
  }
  if (runState.kind === 'malformed') {
    return { action: 'ERROR', reason: `run-state unusable: ${runState.error}` };
  }
  const state = runState.state || {};
  if (state.e8 !== E8_MARKER) {
    return { action: 'RESUME', reason: 'run-state present, no e8 — re-enter member loop (E4)' };
  }
  if (prState === 'MERGED') {
    return { action: 'POST_MERGE_TAIL', reason: 'PR merged — run only the E8.4 post-merge tail' };
  }
  return { action: 'PR_STILL_OPEN', reason: `PR not confirmed merged (state=${prState ?? 'unknown'}) — re-print link and stop; the merge is the user's` };
}

function main() {
  const epicId = process.argv[2];
  if (!epicId) {
    console.error('Usage: resume-gate.mjs <epic-id>');
    process.exit(2);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const shSafe = (cmd) => {
    try { return { ok: true, out: execSync(cmd, { encoding: 'utf8' }).trim(), code: 0 }; }
    catch (err) { return { ok: false, out: (err.stdout || '').toString().trim(), err: (err.stderr || '').toString().trim(), code: err.status ?? 1 }; }
  };

  // Gather run-state via the canonical helper (exit 3 = absent/FRESH, 2 = malformed, 0 = ok JSON).
  const got = shSafe(`node "${join(here, 'runstate.mjs')}" get ${epicId}`);
  let runState;
  if (got.code === 3) runState = { kind: 'absent' };
  else if (got.code === 2) runState = { kind: 'malformed', error: got.err || got.out };
  else if (got.code === 0) {
    try { runState = { kind: 'present', state: JSON.parse(got.out) }; }
    catch (e) { runState = { kind: 'malformed', error: e.message }; }
  } else runState = { kind: 'malformed', error: got.err || `runstate get exited ${got.code}` };

  // Only consult PR state when the e8 hand-off marker is set. Use the BRANCH selector
  // (in run-state) so no PR number is needed on a cold resume; still matches the
  // `gh pr view ... --json state` stub → observable.
  let prState;
  if (runState.kind === 'present' && runState.state?.e8 === E8_MARKER && runState.state?.branch) {
    const pr = shSafe(`gh pr view ${runState.state.branch} --json state -q .state`);
    if (pr.ok) prState = pr.out;
  }

  const { action, reason } = decideResume({ runState, prState });
  console.log(`action=${action}`);
  console.log(reason);
  process.exit(action === 'ERROR' ? 2 : 0);
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .claude/skills/backlog-next-epic/test/resume-gate.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/backlog-next-epic/resume-gate.mjs .claude/skills/backlog-next-epic/test/resume-gate.test.mjs
git commit --no-verify -m "feat(backlog-next-epic): resume-gate.mjs — tested pure resume dispatch (γ)"
```

---

### Task 2: `worktree-ops.mjs` — worktree lifecycle (ensure + cleanup)

**Files:**
- Create: `.claude/skills/backlog-next-epic/worktree-ops.mjs`
- Test: `.claude/skills/backlog-next-epic/test/worktree-ops.test.mjs`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `export function planEnsure({ worktreeExists, branchExists }) → { op }` with `op ∈ {NOOP, ATTACH, CREATE}`.
  - `export function planCleanup({ worktreeExists, branchMerged, mode }) → { removeWorktree, deleteBranch, prune, refuseReason }`; `mode ∈ {'keep-branch','delete-branch'}`.
  - CLI: `worktree-ops.mjs ensure --branch=<b> --worktree=<w>` and `worktree-ops.mjs cleanup --branch=<b> --worktree=<w> --keep-branch|--delete-branch`.

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/backlog-next-epic/test/worktree-ops.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planEnsure, planCleanup } from '../worktree-ops.mjs';

test('planEnsure: worktree already present → NOOP', () => {
  assert.equal(planEnsure({ worktreeExists: true, branchExists: true }).op, 'NOOP');
  assert.equal(planEnsure({ worktreeExists: true, branchExists: false }).op, 'NOOP');
});

test('planEnsure: branch exists, worktree gone (resume after prune) → ATTACH', () => {
  assert.equal(planEnsure({ worktreeExists: false, branchExists: true }).op, 'ATTACH');
});

test('planEnsure: neither exists (fresh run) → CREATE', () => {
  assert.equal(planEnsure({ worktreeExists: false, branchExists: false }).op, 'CREATE');
});

test('planCleanup delete-branch + merged → remove + delete + prune (Step 6.8)', () => {
  const p = planCleanup({ worktreeExists: true, branchMerged: true, mode: 'delete-branch' });
  assert.deepEqual(p, { removeWorktree: true, deleteBranch: true, prune: true, refuseReason: null });
});

test('planCleanup delete-branch + NOT merged → refuse branch delete (safety guard)', () => {
  const p = planCleanup({ worktreeExists: true, branchMerged: false, mode: 'delete-branch' });
  assert.equal(p.deleteBranch, false);
  assert.equal(p.removeWorktree, true);
  assert.match(p.refuseReason, /not merged/i);
});

test('planCleanup keep-branch never deletes, even when merged (E8.2 PR-open stop)', () => {
  const p = planCleanup({ worktreeExists: true, branchMerged: true, mode: 'keep-branch' });
  assert.equal(p.deleteBranch, false);
  assert.equal(p.removeWorktree, true);
  assert.equal(p.refuseReason, null);
});

test('planCleanup idempotent: worktree already gone → removeWorktree false (E8.4 post-tail)', () => {
  const p = planCleanup({ worktreeExists: false, branchMerged: true, mode: 'delete-branch' });
  assert.equal(p.removeWorktree, false);
  assert.equal(p.deleteBranch, true);
  assert.equal(p.prune, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/backlog-next-epic/test/worktree-ops.test.mjs`
Expected: FAIL — `Cannot find module '../worktree-ops.mjs'`.

- [ ] **Step 3: Write minimal implementation**

Create `.claude/skills/backlog-next-epic/worktree-ops.mjs`:

```js
#!/usr/bin/env node
/**
 * Worktree lifecycle for /backlog-next-epic (E2 create, E8.2/E8.4 cleanup) and
 * /backlog-next (Step 6.8 cleanup). Pure planners decide the op from detected
 * state; main() runs `git` (run-for-real / end-state-graded → identical grading
 * to the prose). Touches ONLY git (+ a node_modules symlink). Never gh/nx/deploy.
 *
 * Subcommands:
 *   ensure  --branch=<b> --worktree=<w>
 *       Idempotent create/re-attach: NOOP (worktree present) | ATTACH (branch
 *       exists, worktree pruned) | CREATE (fresh, from origin/main). Ensures the
 *       node_modules symlink → MAIN/node_modules afterwards.
 *   cleanup --branch=<b> --worktree=<w> --keep-branch|--delete-branch
 *       Remove the worktree if present; delete the branch ONLY in delete-branch
 *       mode AND only if it is merged into main (safe `git branch -d`, never -D);
 *       always prune. keep-branch keeps the branch so an open PR stays mergeable.
 *
 * Usage:
 *   node worktree-ops.mjs ensure  --branch=<b> --worktree=<w>
 *   node worktree-ops.mjs cleanup --branch=<b> --worktree=<w> (--keep-branch|--delete-branch)
 * Exit codes: 0 ok · 1 refused (delete requested on an unmerged branch — escalate) · 2 usage.
 */
import { execSync } from 'node:child_process';
import { existsSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Pure: which `git worktree add` form to run (or NOOP). */
export function planEnsure({ worktreeExists, branchExists }) {
  if (worktreeExists) return { op: 'NOOP' };
  if (branchExists) return { op: 'ATTACH' };
  return { op: 'CREATE' };
}

/** Pure: what cleanup to perform. Safety law: deleteBranch is true ONLY in
 * delete-branch mode AND when the branch is merged into main. */
export function planCleanup({ worktreeExists, branchMerged, mode }) {
  const wantDelete = mode === 'delete-branch';
  const deleteBranch = wantDelete && branchMerged === true;
  return {
    removeWorktree: worktreeExists === true,
    deleteBranch,
    prune: true,
    refuseReason: wantDelete && !branchMerged
      ? `branch is not merged into main — refusing 'git branch -d' to avoid data loss (use the PR flow to merge first)`
      : null,
  };
}

// ---- CLI -------------------------------------------------------------------

function flag(args, name) {
  const pre = `--${name}=`;
  const hit = args.find((a) => a.startsWith(pre));
  return hit ? hit.slice(pre.length) : undefined;
}

/** Resolve MAIN (primary worktree root), robust to a dead cwd and to running from
 * inside the worktree being removed: chdir to this script's own dir if cwd is dead,
 * then derive MAIN from the shared git-common-dir parent. */
function resolveMain() {
  try { process.cwd(); } catch { process.chdir(dirname(fileURLToPath(import.meta.url))); }
  const common = execSync('git rev-parse --path-format=absolute --git-common-dir').toString().trim();
  return execSync('git rev-parse --show-toplevel', { cwd: join(common, '..') }).toString().trim();
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const branch = flag(rest, 'branch');
  const worktree = flag(rest, 'worktree');
  if ((cmd !== 'ensure' && cmd !== 'cleanup') || !branch || !worktree) {
    console.error('Usage: worktree-ops.mjs <ensure|cleanup> --branch=<b> --worktree=<w> [--keep-branch|--delete-branch]');
    process.exit(2);
  }
  const MAIN = resolveMain();
  const g = (cmd2, opts = {}) => execSync(cmd2, { cwd: MAIN, encoding: 'utf8', ...opts }).trim();
  const gSafe = (cmd2) => { try { return { ok: true, out: g(cmd2) }; } catch (e) { return { ok: false, out: (e.stdout || '').toString().trim(), err: (e.stderr || '').toString().trim() }; } };
  const worktreeAbs = join(MAIN, worktree);
  const worktreeExists = existsSync(worktreeAbs);

  if (cmd === 'ensure') {
    const branchExists = gSafe(`git rev-parse --verify --quiet refs/heads/${branch}`).ok;
    const { op } = planEnsure({ worktreeExists, branchExists });
    if (op !== 'NOOP') gSafe('git fetch origin main --quiet');
    if (op === 'CREATE') g(`git worktree add -b ${branch} "${worktree}" origin/main`);
    else if (op === 'ATTACH') g(`git worktree add "${worktree}" ${branch}`);
    // node_modules symlink (see feedback-worktree-deploy-friction)
    const nm = join(worktreeAbs, 'node_modules');
    if (!existsSync(nm)) { try { symlinkSync(join(MAIN, 'node_modules'), nm); } catch { /* best-effort */ } }
    console.log(`ensure: op=${op} branch=${branch} worktree=${worktree}`);
    process.exit(0);
  }

  // cleanup
  const mode = rest.includes('--keep-branch') ? 'keep-branch'
    : rest.includes('--delete-branch') ? 'delete-branch' : undefined;
  if (!mode) {
    console.error('cleanup requires --keep-branch or --delete-branch');
    process.exit(2);
  }
  const branchMerged = gSafe(`git merge-base --is-ancestor ${branch} main`).ok;
  const plan = planCleanup({ worktreeExists, branchMerged, mode });
  if (plan.removeWorktree) gSafe(`git worktree remove "${worktree}" --force`);
  if (plan.deleteBranch) gSafe(`git branch -d ${branch}`);
  if (plan.prune) gSafe('git worktree prune');
  console.log(`cleanup: mode=${mode} removeWorktree=${plan.removeWorktree} deleteBranch=${plan.deleteBranch}`);
  if (plan.refuseReason) { console.error(`⚠ ${plan.refuseReason}`); process.exit(1); }
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .claude/skills/backlog-next-epic/test/worktree-ops.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/backlog-next-epic/worktree-ops.mjs .claude/skills/backlog-next-epic/test/worktree-ops.test.mjs
git commit --no-verify -m "feat(backlog-next-epic): worktree-ops.mjs — tested worktree lifecycle (γ)"
```

---

### Task 3: `pr-conflict-resolve.mjs` — F-25 two-kinds conflict resolver

**Files:**
- Create: `.claude/skills/backlog-next-epic/pr-conflict-resolve.mjs`
- Test: `.claude/skills/backlog-next-epic/test/pr-conflict-resolve.test.mjs`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `export function classifyConflicts(paths) → [{ path, action }]` with `action ∈ {REGEN_VIA_LINT, TAKE_BRANCH_SIDE, UNKNOWN}`. CLI: `pr-conflict-resolve.mjs --branch=<epic-branch>` (resolves `docs/backlog/` conflicts after a merge; exit 1 if any UNKNOWN conflict → escalate to the human floor).

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/backlog-next-epic/test/pr-conflict-resolve.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyConflicts } from '../pr-conflict-resolve.mjs';

test('docs/BACKLOG.md → REGEN_VIA_LINT (the auto-index, never hand-resolved)', () => {
  assert.deepEqual(classifyConflicts(['docs/BACKLOG.md']), [{ path: 'docs/BACKLOG.md', action: 'REGEN_VIA_LINT' }]);
});

test('epic + member files → TAKE_BRANCH_SIDE (branch carries shipped frontmatter — F-25)', () => {
  const out = classifyConflicts(['docs/backlog/epic-x.md', 'docs/backlog/member-y.md']);
  assert.deepEqual(out, [
    { path: 'docs/backlog/epic-x.md', action: 'TAKE_BRANCH_SIDE' },
    { path: 'docs/backlog/member-y.md', action: 'TAKE_BRANCH_SIDE' },
  ]);
});

test('mixed: index regen + frontmatter take-branch-side, in input order', () => {
  const out = classifyConflicts(['docs/BACKLOG.md', 'docs/backlog/epic-x.md']);
  assert.deepEqual(out.map((e) => e.action), ['REGEN_VIA_LINT', 'TAKE_BRANCH_SIDE']);
});

test('a non-backlog conflict → UNKNOWN (escalate, not auto-resolvable)', () => {
  assert.deepEqual(classifyConflicts(['src/foo.ts']), [{ path: 'src/foo.ts', action: 'UNKNOWN' }]);
});

test('no conflicts → []', () => {
  assert.deepEqual(classifyConflicts([]), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test .claude/skills/backlog-next-epic/test/pr-conflict-resolve.test.mjs`
Expected: FAIL — `Cannot find module '../pr-conflict-resolve.mjs'`.

- [ ] **Step 3: Write minimal implementation**

Create `.claude/skills/backlog-next-epic/pr-conflict-resolve.mjs`:

```js
#!/usr/bin/env node
/**
 * Resolve the docs/backlog/ merge conflicts that arise when an epic branch meets
 * main at PR time (E8.1). Two kinds, resolved differently (F-25):
 *   - docs/BACKLOG.md (the auto-index) → REGEN_VIA_LINT: never hand-resolved;
 *     regenerated from the merged frontmatter by `node lint.mjs --fix`.
 *   - docs/backlog/<id>.md + any member file → TAKE_BRANCH_SIDE: the branch
 *     carries the shipped frontmatter; keeping main's `active` would rule-11-block
 *     the next epic. Taken via `git checkout <branch> -- <path>` (merge-direction
 *     independent — always the named branch's version).
 *   - anything else → UNKNOWN: escalate to the human floor (exit 1).
 *
 * Ordering is load-bearing: resolve TAKE_BRANCH_SIDE frontmatter FIRST, then run
 * lint --fix to render the index from the now-correct frontmatter.
 *
 * Touches ONLY git + node lint.mjs (run-for-real / end-state-graded). Never gh/nx/deploy.
 *
 * Usage: node pr-conflict-resolve.mjs --branch=<epic-branch>
 * Exit codes: 0 all resolved · 1 an UNKNOWN conflict present (escalate) · 2 usage.
 */
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Pure: classify each conflicted path. Order is preserved. */
export function classifyConflicts(paths) {
  return paths.map((path) => {
    if (path === 'docs/BACKLOG.md') return { path, action: 'REGEN_VIA_LINT' };
    if (/^docs\/backlog\/.+\.md$/.test(path)) return { path, action: 'TAKE_BRANCH_SIDE' };
    return { path, action: 'UNKNOWN' };
  });
}

function flag(args, name) {
  const pre = `--${name}=`;
  const hit = args.find((a) => a.startsWith(pre));
  return hit ? hit.slice(pre.length) : undefined;
}

function main() {
  const args = process.argv.slice(2);
  const branch = flag(args, 'branch');
  if (!branch) {
    console.error('Usage: pr-conflict-resolve.mjs --branch=<epic-branch>');
    process.exit(2);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = execSync('git rev-parse --show-toplevel').toString().trim();
  const g = (cmd) => execSync(cmd, { cwd: repoRoot, encoding: 'utf8' }).trim();

  const conflicts = g('git diff --name-only --diff-filter=U').split('\n').filter(Boolean);
  const plan = classifyConflicts(conflicts);

  const unknown = plan.filter((e) => e.action === 'UNKNOWN');
  if (unknown.length > 0) {
    console.error(`✗ ${unknown.length} non-backlog conflict(s) — escalate to the human floor (resolve by hand):`);
    for (const e of unknown) console.error(`  ${e.path}`);
    process.exit(1);
  }

  // 1. Frontmatter FIRST — take the branch's version (carries shipped frontmatter).
  for (const e of plan.filter((p) => p.action === 'TAKE_BRANCH_SIDE')) {
    g(`git checkout ${branch} -- "${e.path}"`);
    g(`git add "${e.path}"`);
  }
  // 2. THEN regenerate the index from the now-correct frontmatter.
  const regen = plan.filter((p) => p.action === 'REGEN_VIA_LINT');
  if (regen.length > 0) {
    g(`node "${join(here, '../backlog-lint/lint.mjs')}" --fix`);
    for (const e of regen) g(`git add "${e.path}"`);
  }
  console.log(`resolved ${plan.length} docs/backlog conflict(s): ${plan.filter((p) => p.action === 'TAKE_BRANCH_SIDE').length} take-branch-side, ${regen.length} index-regen`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test .claude/skills/backlog-next-epic/test/pr-conflict-resolve.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/backlog-next-epic/pr-conflict-resolve.mjs .claude/skills/backlog-next-epic/test/pr-conflict-resolve.test.mjs
git commit --no-verify -m "feat(backlog-next-epic): pr-conflict-resolve.mjs — tested F-25 two-kinds resolver (γ)"
```

---

### Task 4: Wire the helpers into `backlog-next-epic` SKILL.md

**Files:**
- Modify: `.claude/skills/backlog-next-epic/SKILL.md` (Resume gate, E2, E8.1, E8.2, E8.4 bash blocks)

**Interfaces:**
- Consumes: `resume-gate.mjs` (Task 1), `worktree-ops.mjs` (Task 2), `pr-conflict-resolve.mjs` (Task 3).
- Produces: prose that calls the helpers; no new code symbols.

Replace each extracted bash block with a single helper call + a one-line description; keep the surrounding narrative (when/why) intact. Leave `gh pr view`/`deploy.sh`/`nx`/worker invocations exactly as they are. This task ships no test of its own — it is verified by the full suites in Task 6 plus a `grep` self-check.

- [ ] **Step 1: Replace the Resume gate run-state branching**

In the **Resume gate** section, replace the `node .claude/skills/backlog-next-epic/runstate.mjs get <id>` call + the prose branch-on-result with:

```bash
node .claude/skills/backlog-next-epic/resume-gate.mjs <id>   # prints action=FRESH|RESUME|POST_MERGE_TAIL|PR_STILL_OPEN (exit 2 = malformed)
```

Then branch on the printed `action=`:
- `FRESH` → proceed E0 → E1 → E2 → E3 → E4.
- `RESUME` → skip E0/E1/E3, run E2 idempotently, re-enter the worktree, jump to E4.
- `POST_MERGE_TAIL` → run only the E8.4 post-merge tail.
- `PR_STILL_OPEN` → re-print the PR link and STOP (the merge is the user's; never `gh pr merge`).

(Keep the surrounding explanation of each branch — only the run-state read + dispatch mechanics move into the helper. The helper itself runs `gh pr view <branch>` internally only when the e8 marker is set, so `gh` stays observable.)

- [ ] **Step 2: Replace the E2 worktree create/re-attach block**

Replace the E2 `if ! git ... worktree list | grep ...; then ... worktree add ...` block with:

```bash
node .claude/skills/backlog-next-epic/worktree-ops.mjs ensure \
  --branch=feat/epic-<id> --worktree=.claude/worktrees/epic-<id>   # idempotent create/re-attach + node_modules symlink
```

Keep the note that the worktree is the single epic worktree and that subsequent member work uses it as cwd (set via `cd`, not `EnterWorktree`).

- [ ] **Step 3: Replace the E8.1 PR merge-conflict resolution block**

In E8.1, replace the hand-resolution prose for `docs/backlog/` conflicts with:

```bash
node .claude/skills/backlog-next-epic/pr-conflict-resolve.mjs --branch=feat/epic-<id>   # take-branch-side for <id>.md/members, lint-regen for BACKLOG.md; exit 1 = a non-backlog conflict → resolve by hand
```

Keep the surrounding explanation of the two conflict kinds and WHY take-branch-side (a wrong resolution that keeps `active` rule-11-blocks the next epic). Note that a non-backlog conflict (`exit 1`) escalates to a hand-resolution floor.

- [ ] **Step 4: Replace the E8.2 cleanup-at-the-stop block (keep branch)**

Replace the E8.2 `git worktree remove --force` + `prune` block with:

```bash
node .claude/skills/backlog-next-epic/worktree-ops.mjs cleanup \
  --branch=feat/epic-<id> --worktree=.claude/worktrees/epic-<id> --keep-branch   # remove worktree, KEEP branch (PR stays mergeable), prune
```

Keep the note that the branch (local + remote) and run-state (`e8: PR_OPEN_AWAITING_MERGE`) are KEPT.

- [ ] **Step 5: Replace the E8.4 post-merge-tail branch-delete block**

Replace the E8.4 `merge-base --is-ancestor ... && branch -d ...` + `prune` lines with:

```bash
node .claude/skills/backlog-next-epic/worktree-ops.mjs cleanup \
  --branch=feat/epic-<id> --worktree=.claude/worktrees/epic-<id> --delete-branch   # delete branch ONLY if merged (safe -d), prune; worktree already gone → no-op remove
```

Keep the surrounding tail steps (`git checkout main && git pull --ff-only`, the postflight call, and dropping the run-state) as prose — they are one-shot orchestration.

- [ ] **Step 6: Self-check the wiring**

Run:

```bash
grep -nE 'resume-gate\.mjs|worktree-ops\.mjs (ensure|cleanup)|pr-conflict-resolve\.mjs' .claude/skills/backlog-next-epic/SKILL.md
```

Expected: matches for the resume-gate call, `ensure`, `cleanup --keep-branch`, `cleanup --delete-branch`, and `pr-conflict-resolve`. Confirm no orphaned `merge-base --is-ancestor` / `worktree remove --force` / hand-conflict bash remains for these five blocks:

```bash
grep -nE 'worktree remove --force|merge-base --is-ancestor|checkout --theirs|checkout --ours' .claude/skills/backlog-next-epic/SKILL.md
```

Expected: no matches in the five replaced blocks (matches may remain only inside the Common-mistakes prose if they describe what NOT to do — leave those).

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/backlog-next-epic/SKILL.md
git commit --no-verify -m "refactor(backlog-next-epic): call resume-gate/worktree-ops/pr-conflict-resolve helpers (γ)"
```

---

### Task 5: Wire `worktree-ops.mjs cleanup` into `backlog-next` SKILL.md Step 6.8

**Files:**
- Modify: `.claude/skills/backlog-next/SKILL.md` (Step 6.8 cleanup block)

**Interfaces:**
- Consumes: `worktree-ops.mjs` (Task 2), referenced by the cross-skill path `.claude/skills/backlog-next-epic/worktree-ops.mjs` (exactly as `backlog-next-epic` already calls `backlog-next/preflight.mjs`).
- Produces: prose that calls the helper.

- [ ] **Step 1: Replace the Step 6.8 cleanup block**

Replace the Step 6.8 `MAIN=$(...)` + `merge-base --is-ancestor ... && echo SAFE-TO-REMOVE` + `worktree remove --force` + `branch -d` + `prune` block with:

```bash
node .claude/skills/backlog-next-epic/worktree-ops.mjs cleanup \
  --branch=<feature-branch> --worktree=.claude/worktrees/<name> --delete-branch   # remove worktree, delete branch (safe -d, only if merged), prune
```

Keep the surrounding narrative about why git (not `ExitWorktree`) is used and that this breaks the phantom-session leak cycle. Keep the optional best-effort `ExitWorktree action: "keep"` note.

- [ ] **Step 2: Self-check the wiring**

Run:

```bash
grep -n 'worktree-ops.mjs cleanup' .claude/skills/backlog-next/SKILL.md
```

Expected: one match (the Step 6.8 delete-branch call).

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/backlog-next/SKILL.md
git commit --no-verify -m "refactor(backlog-next): Step 6.8 cleanup calls worktree-ops.mjs (γ)"
```

---

### Task 6: Full test-suite verification (both skills)

**Files:**
- No new files — runs the existing + new suites.

- [ ] **Step 1: Run the backlog-next-epic suite (incl. the 3 new helpers)**

Run: `node --test .claude/skills/backlog-next-epic/test/*.test.mjs`
Expected: PASS — all existing suites plus `resume-gate` (7), `worktree-ops` (7), `pr-conflict-resolve` (5).

- [ ] **Step 2: Run the backlog-next suite**

Run: `node --test .claude/skills/backlog-next/test/*.test.mjs`
Expected: PASS (unchanged — Step 6.8 wiring is prose-only).

- [ ] **Step 3: Confirm backlog-lint still green**

Run: `node .claude/skills/backlog-lint/lint.mjs`
Expected: `✓ … all 11 rules pass`.

- [ ] **Step 4: Commit (only if anything changed; otherwise skip)**

No code change expected here — this task is a verification gate. If a test surfaced a fix, commit it with the fix.

---

## Self-Review

**1. Spec coverage:**
- §3 extract-vs-leave → Tasks 1–3 extract resume-gate / worktree-ops / pr-conflict-resolve; LEAVE items (phantom self-heal, post-merge-tail sequencing) are explicitly kept as prose in Tasks 4–5. ✓
- §4.1 resume-gate (dispatch matrix, injected prState, F-11/F-13) → Task 1 (pure `decideResume` + tests; `gh pr view <branch>` in `main()`). ✓
- §4.2 worktree-ops (ensure + cleanup, merge-base safety, keep/delete) → Task 2 (`planEnsure`/`planCleanup` + safety-guard test). ✓
- §4.3 pr-conflict-resolve (two-kinds, ordering, F-25) → Task 3 (`classifyConflicts` + ordering in `main()`). ✓
- §2 observability (only git + node lint.mjs; gh stays in prose/main) → Global Constraints + every helper's side-effect list; verified by Task 4/5 grep self-checks. ✓
- §5 SKILL.md prose changes → Tasks 4 (5 blocks) + 5 (Step 6.8). ✓
- §6 testing → Task 6. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step states the exact command + expected outcome. The only `<id>`/`<name>`/`<feature-branch>` tokens are literal SKILL.md prose placeholders (the skills themselves use them) — intentional, not plan placeholders. ✓

**3. Type consistency:** `decideResume({runState, prState})`/`RESUME_ACTIONS`, `planEnsure({worktreeExists, branchExists})→{op}`, `planCleanup({worktreeExists, branchMerged, mode})→{removeWorktree, deleteBranch, prune, refuseReason}`, `classifyConflicts(paths)→[{path, action}]` — names + shapes match between each helper, its test, and the Interfaces blocks. CLI flags (`--branch`, `--worktree`, `--keep-branch`, `--delete-branch`) are consistent across Tasks 2/4/5. ✓
