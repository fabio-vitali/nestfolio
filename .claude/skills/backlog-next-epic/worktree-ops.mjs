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
