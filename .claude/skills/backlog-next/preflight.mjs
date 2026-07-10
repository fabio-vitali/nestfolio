#!/usr/bin/env node
/**
 * Preflight gate for /backlog-next.
 *
 * Hard-fails if the workspace is in a state that would contaminate a new
 * workstream. Run BEFORE picking the next item. Do not bypass.
 *
 * Usage:
 *   node preflight.mjs [--lane=<doc-layer|simple|complex|epic-member>]
 *
 * Checks (standard — no --lane, or doc-layer/simple/complex):
 *   1. Working tree is clean (no staged or unstaged changes).
 *   2. Local main is not ahead of origin/main (no unpushed local commits).
 *   3. `backlog-lint` passes.
 *   4. No stale git worktrees (broken paths or prunable entries).
 *
 * Checks (--lane=epic-member — the worker runs INSIDE the active epic worktree,
 * on the epic branch; the orchestrator already ran the full preflight once at
 * epic-start): only 1 (tree-clean within the worktree) + 3 (backlog-lint). The
 * on-main / main-ahead / stale-worktree checks and the snapshot+daemon
 * side-effects are skipped — the worktree is legitimately present and the epic
 * branch legitimately carries prior members' commits, and overwriting the
 * snapshot would reset the epic-level postflight's delta baseline.
 *
 * Exit code 0 on success, 1 on any failure, 2 on bad usage.
 */
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backlogGate } from './backlog-gate.mjs';

export const VALID_LANES = ['doc-layer', 'simple', 'complex', 'epic-member'];

/**
 * Whether this lane skips the branch-scope checks (on-main, main-ahead,
 * stale-worktrees) and the snapshot+daemon side-effects. Only epic-member does:
 * it runs inside the active epic worktree on the epic branch.
 */
export function skipsBranchScopeChecks(lane) {
  return lane === 'epic-member';
}

function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const m = a.match(/^--([^=]+)=(.*)$/);
      return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
    }),
  );

  const lane = args.lane;
  if (lane && !VALID_LANES.includes(lane)) {
    console.error(`Usage: preflight.mjs [--lane=<${VALID_LANES.join('|')}>]`);
    process.exit(2);
  }
  const epicMember = skipsBranchScopeChecks(lane);

  const REPO_ROOT = execSync('git rev-parse --show-toplevel').toString().trim();
  const sh = (cmd, opts = {}) => execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', ...opts }).trim();
  const shSafe = (cmd) => {
    try { return { ok: true, out: sh(cmd) }; }
    catch (err) { return { ok: false, out: (err.stdout || '').toString().trim(), err: (err.stderr || '').toString().trim() }; }
  };

  const failures = [];

  // 1. Tree clean (always — in epic-member mode this is the worktree's tree).
  const status = sh('git status --porcelain');
  if (status.length > 0) {
    failures.push({
      rule: 'tree-clean',
      message: epicMember
        ? 'Worktree is dirty. Commit or revert the previous member before starting the next one.'
        : 'Working tree is dirty. Commit, stash, or discard before starting a new workstream.',
      detail: status,
    });
  }

  // 2. Local main vs origin/main — standard lanes only (epic-member is on the epic branch).
  if (!epicMember) {
    const currentBranch = sh('git rev-parse --abbrev-ref HEAD');
    if (currentBranch === 'main') {
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
        message: `Preflight expects to run from main (current: ${currentBranch}). A new workstream should start from a clean main; if you intended to resume an ACTIVE workstream on a feature branch, skip preflight. (For epic members driven by /backlog-next-epic, run with --lane=epic-member.)`,
      });
    }
  }

  // 3. Backlog store validation (always) — the runtime watch gate scoped to the backlog store.
  const gate = backlogGate();
  const gateRes = shSafe(gate.cmd);
  if (!gateRes.ok) {
    failures.push({
      rule: gate.rule,
      message: `${gate.label} failed. Fix violations before starting a new workstream.`,
      detail: [gateRes.out, gateRes.err].filter(Boolean).join('\n'),
    });
  }

  // 4. Stale worktrees — standard lanes only (the live epic worktree is legitimate).
  if (!epicMember) {
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
        message: `${stale.length} stale worktree(s) detected. Clean up with \`git worktree prune\` or \`git worktree remove <path>\`.`,
        detail: stale.map((e) => e.worktree).join('\n'),
      });
    }
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

  // 5. On success only (standard lanes): persist a git-status snapshot for
  // postflight's delta-check, and stop the Nx daemon so its next start rebinds
  // a clean socket. Skipped for epic-member: the orchestrator owns the snapshot
  // (overwriting it per-member would reset the epic-level postflight baseline).
  if (!epicMember) {
    const snapshotPath = join(
      sh('git rev-parse --path-format=absolute --git-common-dir'),
      'backlog-next-snapshot.json',
    );
    writeFileSync(
      snapshotPath,
      JSON.stringify({ timestamp: new Date().toISOString(), status }, null, 2),
    );
    shSafe('pnpm nx daemon --stop');
    console.log('✓ Preflight passed: tree clean, main = origin/main, backlog checks green, no stale worktrees.');
  } else {
    console.log('✓ Preflight passed (lane=epic-member): worktree tree clean, backlog checks green.');
  }
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
