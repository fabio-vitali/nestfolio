#!/usr/bin/env node
/**
 * Preflight gate for /backlog-next.
 *
 * Hard-fails if the workspace is in a state that would contaminate a new
 * workstream. Run BEFORE picking the next item. Do not bypass.
 *
 * Checks:
 *   1. Working tree is clean (no staged or unstaged changes).
 *   2. Local main is not ahead of origin/main (no unpushed local commits).
 *   3. `backlog-lint` passes (all 8 invariants).
 *   4. No stale git worktrees (broken paths or prunable entries).
 *
 * Exit code 0 on success, 1 on any failure.
 */
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = execSync('git rev-parse --show-toplevel').toString().trim();

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', ...opts }).trim();
}

function shSafe(cmd) {
  try { return { ok: true, out: sh(cmd) }; }
  catch (err) { return { ok: false, out: (err.stdout || '').toString().trim(), err: (err.stderr || '').toString().trim() }; }
}

const failures = [];

// 1. Tree clean
const status = sh('git status --porcelain');
if (status.length > 0) {
  failures.push({
    rule: 'tree-clean',
    message: 'Working tree is dirty. Commit, stash, or discard before starting a new workstream.',
    detail: status,
  });
}

// 2. Local main vs origin/main
const currentBranch = sh('git rev-parse --abbrev-ref HEAD');
if (currentBranch === 'main') {
  // Make sure we have origin/main to compare against
  const fetched = shSafe('git rev-parse --verify --quiet origin/main');
  if (fetched.ok) {
    const ahead = sh('git rev-list --count origin/main..main');
    if (Number(ahead) > 0) {
      const unpushed = sh('git log origin/main..main --oneline');
      failures.push({
        rule: 'main-not-ahead',
        message: `Local main is ${ahead} commit(s) ahead of origin/main. Push or reset before starting a new workstream — pre-worktree commits on main cascade into FF-merges and orphan commits after PR squash-merge.`,
        detail: unpushed,
      });
    }
  } else {
    failures.push({
      rule: 'origin-main-missing',
      message: 'origin/main ref not found locally. Run `git fetch origin` and retry.',
    });
  }
} else {
  failures.push({
    rule: 'not-on-main',
    message: `Preflight expects to run from main (current: ${currentBranch}). A new workstream should start from a clean main; if you intended to resume an ACTIVE workstream on a feature branch, skip preflight.`,
  });
}

// 3. backlog-lint
const lintPath = join(REPO_ROOT, '.claude/skills/backlog-lint/lint.mjs');
if (!existsSync(lintPath)) {
  failures.push({ rule: 'lint-missing', message: `Expected ${lintPath} not found.` });
} else {
  const lint = shSafe(`node "${lintPath}"`);
  if (!lint.ok) {
    failures.push({
      rule: 'backlog-lint',
      message: 'backlog-lint failed. Fix violations before starting a new workstream.',
      detail: [lint.out, lint.err].filter(Boolean).join('\n'),
    });
  }
}

// 4. Stale worktrees
const worktrees = sh('git worktree list --porcelain');
const stale = [];
let currentEntry = {};
for (const line of worktrees.split('\n')) {
  if (line.startsWith('worktree ')) {
    if (currentEntry.worktree) {
      if (currentEntry.prunable || (currentEntry.worktree !== REPO_ROOT && !existsSync(currentEntry.worktree))) {
        stale.push(currentEntry);
      }
    }
    currentEntry = { worktree: line.slice('worktree '.length) };
  } else if (line.startsWith('prunable')) {
    currentEntry.prunable = true;
  } else if (line === '') {
    if (currentEntry.worktree) {
      if (currentEntry.prunable || (currentEntry.worktree !== REPO_ROOT && !existsSync(currentEntry.worktree))) {
        stale.push(currentEntry);
      }
      currentEntry = {};
    }
  }
}
if (currentEntry.worktree) {
  if (currentEntry.prunable || (currentEntry.worktree !== REPO_ROOT && !existsSync(currentEntry.worktree))) {
    stale.push(currentEntry);
  }
}
if (stale.length > 0) {
  failures.push({
    rule: 'stale-worktrees',
    message: `${stale.length} stale worktree(s) detected. Clean up with \`git worktree prune\` or \`git worktree remove <path>\`.`,
    detail: stale.map((e) => e.worktree).join('\n'),
  });
}

// Report
if (failures.length > 0) {
  console.error(`✗ Preflight failed (${failures.length} check${failures.length === 1 ? '' : 's'}):\n`);
  for (const f of failures) {
    console.error(`  [${f.rule}] ${f.message}`);
    if (f.detail) {
      console.error(f.detail.split('\n').map((l) => `      ${l}`).join('\n'));
    }
  }
  console.error('\nFix the surfaced state before starting a new workstream. Do not bypass.');
  process.exit(1);
}

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
