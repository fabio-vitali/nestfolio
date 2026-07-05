#!/usr/bin/env node
// runtime/adapters/git/ship-recheck.mjs — ring-2 ship-boundary adjudication (§3.3): the gate's sibling,
// scoped to the BRANCH delta instead of the staged set. The single adjudication point: catches what
// RUNTIME_GATE_SKIP bypassed AND what --no-verify worktree commits (project SOP) never ran. Skip debt
// is cleared when the latest gate-clean postdates the latest skip (postflight verifies).
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { loadRegistry, registryErrorLines } from '../../engine/lib/load-registry.mjs';
import { runWatch, loadTriggers } from '../../engine/lib/run-watch.mjs';
import { makeJournal, gitHeadSha } from '../../engine/lib/journal.mjs';
import { CURATE_CMD } from './pre-commit-gate.mjs';

export function readBranchDelta(base, exec = (c) => execSync(c, { encoding: 'utf8' })) {
  return exec(`git diff --name-only --diff-filter=ACMR ${base}..HEAD`).split('\n').filter(Boolean);
}

export async function runShipRecheck({ changedFiles, registry, trigger, watch = runWatch }) {
  const findings = await watch({ registry, trigger, changedScope: changedFiles, stagedFiles: changedFiles });
  return { exitCode: findings.length ? 1 : 0, findings };
}

export function recordGateClean({ journal, item, sha, base, ts }) {
  journal.begin('backward', { runId: 'backward', auto: false });
  journal.record('backward', `ship:${item}:gate-clean`, { sha, base, ts });
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const val = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
    const item = val('--item');
    const base = val('--base') ?? 'origin/main';
    if (!item || item.startsWith('--')) { console.error('usage: ship-recheck.mjs --item <id> [--base <ref>]'); process.exit(2); }
    const cfg = JSON.parse(readFileSync('runtime/runtime.config.json', 'utf8'));
    const registry = loadRegistry({ checksDir: cfg.checksDir });
    const errLines = registryErrorLines(registry);
    if (errLines) {
      console.error('ship-recheck: check registry corrupt (fail-closed):');
      for (const line of errLines) console.error(line);
      process.exit(2);
    }
    const trigger = loadTriggers(cfg.triggersFile).find((t) => t.on === 'commit');
    if (!trigger) { console.error('ship-recheck: no "commit" trigger in triggers.yaml'); process.exit(2); }
    const { exitCode, findings } = await runShipRecheck({ changedFiles: readBranchDelta(base), registry, trigger });
    for (const f of findings) {
      console.error(`  ✖ ${f.check}  ${(f.scope ?? []).join(',')}  ${f.detail}`);
      console.error(`      deliberate property change? → ${CURATE_CMD(f.check)}`);
    }
    if (findings.length) { console.error(`ship-recheck: ${findings.length} finding(s) on ${base}..HEAD — fix or curate before shipping.`); process.exit(1); }
    recordGateClean({ journal: makeJournal({}), item, sha: gitHeadSha(), base, ts: new Date().toISOString() });
    console.log(`ship-recheck: clean on ${base}..HEAD — journaled ship:${item}:gate-clean`);
    process.exit(0);
  } catch (e) {
    console.error(`ship-recheck: crashed (fail-closed): ${e.message}`);
    process.exit(2);
  }
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
