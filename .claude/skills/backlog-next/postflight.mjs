#!/usr/bin/env node
/**
 * Postflight gate for /backlog-next.
 *
 * Hard-fails if the workstream is not actually closed cleanly. Run AFTER the
 * closing phase (steps 6 of SKILL.md). Do not bypass.
 *
 * Usage:
 *   node postflight.mjs --lane=<doc-layer|simple|complex> [--branch=<feat-branch>] [--id=<backlog-id>]
 *
 * Checks (always):
 *   1. Working tree is clean.
 *   2. `backlog-lint` passes.
 *   3. If --id given: that file is status=shipped with non-empty validation_gate.
 *
 * Checks (complex lane only):
 *   4. We are back on main (worktree exited).
 *   5. Local main is in sync with origin/main (PR merged, fast-forwarded).
 *   6. If --branch given: branch is deleted both locally and on origin.
 *   7. No stale worktrees remain.
 *
 * Exit code 0 on success, 1 on any failure.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = execSync('git rev-parse --show-toplevel').toString().trim();

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);

const lane = args.lane;
if (!lane || !['doc-layer', 'simple', 'complex'].includes(lane)) {
  console.error('Usage: postflight.mjs --lane=<doc-layer|simple|complex> [--branch=<feat-branch>] [--id=<backlog-id>]');
  process.exit(2);
}

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
    message: 'Working tree is dirty. Commit or revert before declaring the workstream done.',
    detail: status,
  });
}

// 2. backlog-lint
const lintPath = join(REPO_ROOT, '.claude/skills/backlog-lint/lint.mjs');
const lint = shSafe(`node "${lintPath}"`);
if (!lint.ok) {
  failures.push({
    rule: 'backlog-lint',
    message: 'backlog-lint failed. Fix violations before declaring the workstream done.',
    detail: [lint.out, lint.err].filter(Boolean).join('\n'),
  });
}

// 3. Shipped frontmatter
if (args.id) {
  const file = join(REPO_ROOT, 'docs/backlog', `${args.id}.md`);
  if (!existsSync(file)) {
    failures.push({ rule: 'id-missing', message: `docs/backlog/${args.id}.md not found.` });
  } else {
    const body = readFileSync(file, 'utf8');
    const fm = body.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) {
      failures.push({ rule: 'frontmatter', message: `No frontmatter in docs/backlog/${args.id}.md.` });
    } else {
      const status = fm[1].match(/^status:\s*(\S+)/m)?.[1];
      const vg = fm[1].match(/^validation_gate:\s*(.+)$/m)?.[1]?.trim();
      if (status !== 'shipped') {
        failures.push({
          rule: 'status-shipped',
          message: `docs/backlog/${args.id}.md still has status: ${status}. Closing phase did not flip to shipped.`,
        });
      }
      if (!vg || vg === 'null' || vg === '""' || vg === "''") {
        failures.push({
          rule: 'validation-gate',
          message: `docs/backlog/${args.id}.md has empty validation_gate. Fill it with evidence (commit SHA, e2e run, deploy output).`,
        });
      }
    }
  }
}

// 4-7. Complex lane only
if (lane === 'complex') {
  const currentBranch = sh('git rev-parse --abbrev-ref HEAD');

  // 4. Back on main
  if (currentBranch !== 'main') {
    failures.push({
      rule: 'back-on-main',
      message: `Expected to be on main after closing phase (current: ${currentBranch}). Did finishing-a-development-branch run?`,
    });
  }

  // 5. main = origin/main
  const fetched = shSafe('git fetch origin --quiet');
  if (fetched.ok) {
    const ahead = shSafe('git rev-list --count origin/main..main').out;
    const behind = shSafe('git rev-list --count main..origin/main').out;
    if (Number(ahead) > 0 || Number(behind) > 0) {
      failures.push({
        rule: 'main-sync',
        message: `Local main diverges from origin/main (ahead ${ahead}, behind ${behind}). Fast-forward or reconcile.`,
      });
    }
  }

  // 6. Branch deleted
  if (args.branch) {
    const localExists = shSafe(`git rev-parse --verify --quiet refs/heads/${args.branch}`).ok;
    const remoteExists = shSafe(`git rev-parse --verify --quiet refs/remotes/origin/${args.branch}`).ok;
    if (localExists) {
      failures.push({
        rule: 'branch-local-leftover',
        message: `Local branch '${args.branch}' still exists. Delete with \`git branch -d ${args.branch}\` (or -D if squash-merged).`,
      });
    }
    if (remoteExists) {
      failures.push({
        rule: 'branch-remote-leftover',
        message: `Remote branch 'origin/${args.branch}' still exists. Delete with \`git push origin --delete ${args.branch}\` or use \`gh pr merge --delete-branch\`.`,
      });
    }
  }

  // 7. No stale worktrees
  const worktrees = sh('git worktree list --porcelain');
  const stale = [];
  let currentEntry = {};
  const flush = () => {
    if (currentEntry.worktree) {
      if (currentEntry.prunable || (currentEntry.worktree !== REPO_ROOT && !existsSync(currentEntry.worktree))) {
        stale.push(currentEntry);
      }
    }
  };
  for (const line of worktrees.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush();
      currentEntry = { worktree: line.slice('worktree '.length) };
    } else if (line.startsWith('prunable')) {
      currentEntry.prunable = true;
    } else if (line === '') {
      flush();
      currentEntry = {};
    }
  }
  flush();
  if (stale.length > 0) {
    failures.push({
      rule: 'stale-worktrees',
      message: `${stale.length} stale worktree(s) remain. Clean up with \`git worktree remove\` or \`git worktree prune\`.`,
      detail: stale.map((e) => e.worktree).join('\n'),
    });
  }
}

// Report
if (failures.length > 0) {
  console.error(`✗ Postflight failed (${failures.length} check${failures.length === 1 ? '' : 's'}):\n`);
  for (const f of failures) {
    console.error(`  [${f.rule}] ${f.message}`);
    if (f.detail) {
      console.error(f.detail.split('\n').map((l) => `      ${l}`).join('\n'));
    }
  }
  console.error('\nClose out the surfaced state before declaring the workstream done.');
  process.exit(1);
}

console.log(`✓ Postflight passed (lane=${lane}): tree clean, backlog-lint green${lane === 'complex' ? ', on main, synced with origin, no stale worktrees' : ''}.`);
