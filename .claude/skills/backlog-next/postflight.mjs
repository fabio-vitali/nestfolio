#!/usr/bin/env node
/**
 * Postflight gate for /backlog-next.
 *
 * Hard-fails if the workstream is not actually closed cleanly. Run AFTER the
 * closing phase (steps 6 of SKILL.md). Do not bypass.
 *
 * Usage:
 *   node postflight.mjs --lane=<doc-layer|simple|complex|epic-member> [--branch=<feat-branch>] [--id=<backlog-id>]
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
 * The `epic-member` lane runs only checks 1–3: an epic member stays on the epic
 * branch inside the epic worktree (no merge/exit yet), so checks 4–7 belong to
 * the epic-level close run by /backlog-next-epic, not the per-member postflight.
 *
 * Exit code 0 on success, 1 on any failure, 2 on bad usage.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeJournal } from '../../../runtime/engine/lib/journal.mjs';
import { backlogGate } from './backlog-gate.mjs';

export const VALID_LANES = ['doc-layer', 'simple', 'complex', 'epic-member'];

/** Whether this lane runs the complex-only checks 4–7 (back-on-main, main-sync,
 * branch-deleted, no-stale-worktrees). Only the `complex` lane does — the
 * `epic-member` lane defers them to the epic-level close. */
export function runsComplexChecks(lane) {
  return lane === 'complex';
}

/** Backward-edge ritual evidence (§4.2, runtime-backward-edge-live) — pure, so the matrix test can
 * feed synthetic ledgers. Missing snapshot ⇒ degrade to existence-only with a warning; the hard
 * requirement (records exist) stays. */
export function backwardEvidenceFailures({ backwardLedger, skipsLedger, id, snapshotTimestamp }) {
  const failures = [];
  const warnings = [];
  const windowed = Boolean(snapshotTimestamp);
  if (!windowed) warnings.push('no preflight snapshot found — backward-edge evidence checks degraded to existence-only');
  const steps = backwardLedger?.steps ?? new Map();

  const clean = steps.get(`ship:${id}:gate-clean`);
  if (!clean || clean.status !== 'complete') {
    failures.push({ rule: 'ship-gate-evidence',
      message: `no ship:${id}:gate-clean record on runId 'backward'. Run: node runtime/adapters/git/ship-recheck.mjs --item ${id}` });
  } else if (windowed && !(clean.ts > snapshotTimestamp)) {
    failures.push({ rule: 'ship-gate-evidence',
      message: `ship:${id}:gate-clean (${clean.ts}) predates the preflight snapshot (${snapshotTimestamp}) — stale evidence; re-run ship-recheck.` });
  } else {
    const skips = [...(skipsLedger?.steps?.values() ?? [])].filter((r) => r.key.startsWith('skip:') && r.ts > clean.ts);
    if (skips.length) failures.push({ rule: 'ship-gate-evidence',
      message: `${skips.length} RUNTIME_GATE_SKIP use(s) postdate the last gate-clean — unadjudicated skip debt; re-run ship-recheck.`,
      detail: skips.map((s) => s.key).join('\n') });
  }

  const considered = steps.get(`consider:${id}`);
  if (!considered || considered.status !== 'complete') {
    failures.push({ rule: 'mint-considered',
      message: `no consider:${id} record on runId 'backward'. Record the mint consideration ("none" is a legal answer): node runtime/adapters/claude-code/run-backward.mjs consider --item ${id} (--minted <check-id> | --none) --reason '…'` });
  } else if (windowed && !(considered.ts > snapshotTimestamp)) {
    failures.push({ rule: 'mint-considered',
      message: `consider:${id} (${considered.ts}) predates the preflight snapshot — record THIS workstream's consideration.` });
  }
  return { failures, warnings };
}

/** Item-9 teeth (redteam 2026-07-04): the only sanctioned commits AFTER a green ship-recheck are the
 * 6.5/6.6 docs tail. A non-docs path in <gate-clean.sha>..HEAD is an unadjudicated code commit.
 * filesSinceClean == null ⇒ the sha is not an ancestor of HEAD (squash-merge) — warn, cannot adjudicate. */
const SANCTIONED_POST_RECHECK = [/^docs\/backlog\//, /^docs\/BACKLOG\.md$/];
export function gateCleanFreshness({ cleanValue, filesSinceClean }) {
  if (filesSinceClean == null) return { failures: [], warnings: [
    `gate-clean sha ${cleanValue?.sha ?? '(missing)'} is not an ancestor of HEAD — cannot adjudicate post-recheck commits (squash-merge?); verify the branch delta manually.`] };
  const code = filesSinceClean.filter((f) => !SANCTIONED_POST_RECHECK.some((rx) => rx.test(f)));
  if (!code.length) return { failures: [], warnings: [] };
  return { failures: [{ rule: 'ship-gate-evidence',
    message: `${code.length} non-docs path(s) changed after the last gate-clean (${cleanValue.sha}) — unadjudicated code commits; re-run ship-recheck.`,
    detail: code.join('\n') }], warnings: [] };
}

/** Resolve REPO_ROOT for the CURRENT working tree, robust to a DEAD cwd. `--show-toplevel`
 * is the right answer per-context — the WORKTREE root for an epic-member run (whose shipped
 * frontmatter + tree live on the branch) and MAIN for the complex close (run from $MAIN after
 * the worktree is gone). The only real F-23 failure was a *dead* cwd (postflight invoked right
 * after the worktree it sat in was removed): guard it by chdir-ing to this script's own dir
 * (always live — it's the file node is executing) before the git call. Callers also cd to a
 * live dir first (epic E8.4 / `/backlog-next` Step 7) as the primary defense. */
function resolveRepoRoot() {
  try { process.cwd(); } catch { process.chdir(dirname(fileURLToPath(import.meta.url))); }
  return execSync('git rev-parse --show-toplevel').toString().trim();
}

function main() {
  const REPO_ROOT = resolveRepoRoot();

  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const m = a.match(/^--([^=]+)=(.*)$/);
      return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
    }),
  );

  const lane = args.lane;
  if (!lane || !VALID_LANES.includes(lane)) {
    console.error(`Usage: postflight.mjs --lane=<${VALID_LANES.join('|')}> [--branch=<feat-branch>] [--id=<backlog-id>]`);
    process.exit(2);
  }

  const sh = (cmd, opts = {}) => execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', ...opts }).trim();
  const shSafe = (cmd) => {
    try { return { ok: true, out: sh(cmd) }; }
    catch (err) { return { ok: false, out: (err.stdout || '').toString().trim(), err: (err.stderr || '').toString().trim() }; }
  };

  const failures = [];
  const warnings = [];

  // 1. Tree clean — delta-aware. Excuses dirt that (a) existed at preflight or
  // (b) is known background-tool litter; sweeps litter dirs from the repo root.
  const LITTER_PATTERNS = [
    /^tmp-\d+-[a-z0-9]+$/,
    /^nx-native-file-cache-[0-9a-f]+$/,
    /^node-compile-cache$/,
  ];
  const HEX_DIR = /^[0-9a-f]{20}$/;

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
  const gitCommonDirAbs = sh('git rev-parse --path-format=absolute --git-common-dir');
  let snapshot = { timestamp: null, status: '' };
  const snapshotPath = join(gitCommonDirAbs, 'backlog-next-snapshot.json');
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

  // 2. Backlog store validation — the runtime watch gate scoped to the backlog store.
  const gate = backlogGate();
  const gateRes = shSafe(gate.cmd);
  if (!gateRes.ok) {
    failures.push({
      rule: gate.rule,
      message: `${gate.label} failed. Fix violations before declaring the workstream done.`,
      detail: [gateRes.out, gateRes.err].filter(Boolean).join('\n'),
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
        const fmStatus = fm[1].match(/^status:\s*(\S+)/m)?.[1];
        const vg = fm[1].match(/^validation_gate:\s*(.+)$/m)?.[1]?.trim();
        if (fmStatus !== 'shipped') {
          failures.push({
            rule: 'status-shipped',
            message: `docs/backlog/${args.id}.md still has status: ${fmStatus}. Closing phase did not flip to shipped.`,
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

  // 3b. Backward-edge ritual evidence (simple + complex; doc-layer exempt; epic-member defers to epic close).
  if (args.id && (lane === 'simple' || lane === 'complex')) {
    try {
      const journal = makeJournal({ root: gitCommonDirAbs });
      const backwardLedger = journal.read('backward');
      const r = backwardEvidenceFailures({ backwardLedger,
        skipsLedger: journal.read('gate-skips'), id: args.id, snapshotTimestamp: snapshot.timestamp });
      failures.push(...r.failures);
      warnings.push(...r.warnings);

      // Item-9 sha teeth: a fresh gate-clean must also be the LAST adjudicated code state — only the
      // sanctioned docs tail may follow it (catches --no-verify code commits made after the recheck).
      const clean = backwardLedger?.steps?.get(`ship:${args.id}:gate-clean`);
      if (clean?.status === 'complete' && clean.value?.sha) {
        const ancestor = shSafe(`git merge-base --is-ancestor ${clean.value.sha} HEAD`);
        const filesSinceClean = ancestor.ok
          ? shSafe(`git diff --name-only ${clean.value.sha}..HEAD`).out.split('\n').filter(Boolean)
          : null;
        const fr = gateCleanFreshness({ cleanValue: clean.value, filesSinceClean });
        failures.push(...fr.failures);
        warnings.push(...fr.warnings);
      }
    } catch (e) {
      failures.push({ rule: 'ship-gate-evidence', message: `could not read the backward journal: ${e.message}` });
    }
  }

  // 4-7. Complex lane only (the epic-member lane defers these to the epic close).
  if (runsComplexChecks(lane)) {
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

  console.log(`✓ Postflight passed (lane=${lane}): tree clean, backlog checks green${runsComplexChecks(lane) ? ', on main, synced with origin, no stale worktrees' : ''}.`);
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
