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
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
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
      if (!/\b(nx|jest)\b/.test(line)) continue;
      const started = Date.parse(line.slice(0, 24));         // lstart is 24-char ctime
      if (!Number.isNaN(started) && started < snapMs) warnings.push(line.trim());
    }
  }
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
// Informational output (prints whether or not the gate passes).
if (swept.length > 0) {
  console.log(`  swept ${swept.length} background-litter dir(s) from repo root: ${swept.join(', ')}`);
}
for (const w of warnings) {
  console.warn(`  ⚠ orphan nx/jest process predates this workstream (likely litter source): ${w}`);
}

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
