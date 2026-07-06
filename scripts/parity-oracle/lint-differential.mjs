#!/usr/bin/env node
// scripts/parity-oracle/lint-differential.mjs — the deterministic half of lint parity: run BOTH engines
// over shared per-rule good/bad stores and classify. No LLM. Legacy = backlog-lint lint.mjs (exit code);
// runtime = run-watch --on=manual over the seeded registry (exit 1 = findings; exit 2 = crash, which is
// NOT a catch). classes: both-catch | legacy-only | runtime-only | both-miss | good-false-positive.
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStoreSandbox } from './store-sandbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const RULE_MAP = [
  { rule: 'r1-id-matches-filename', checks: ['backlog-id-matches-filename'], mapped: true },
  { rule: 'r2-single-active', checks: ['single-active'], mapped: true },
  { rule: 'r3-references-valid', checks: ['references-valid'], mapped: true },
  { rule: 'r4-active-out-of-scope', checks: [], mapped: false },
  { rule: 'r5-shipped-validation-gate', checks: [], mapped: false },
  { rule: 'r6-queued-ranks', checks: [], mapped: false },
  { rule: 'r8-promotion-trigger', checks: [], mapped: false },
  // r9/r10: no dedicated runtime check (still P4 gaps), but the stores are caught TRANSITIVELY — the
  // legacy index render omits epic members whose anchor is terminal (r9) or not-an-epic (r10), so the
  // generic index-fresh law fires on the unlisted live member. Observed class: both-catch.
  { rule: 'r9-epic-closure', checks: [], mapped: false, transitive: 'index-fresh' },
  { rule: 'r10-epic-pointer', checks: [], mapped: false, transitive: 'index-fresh' },
  { rule: 'r11-single-active-epic', checks: ['single-active'], mapped: true },
  { rule: 'index-matches', checks: ['index-fresh'], mapped: true },
  { rule: 'element-shape', checks: ['item-store-valid'], mapped: true, runtimeOnly: true },
];

function legacyExit(dir) {
  const r = spawnSync('node', ['.claude/skills/backlog-lint/lint.mjs'], { cwd: dir, encoding: 'utf8',
    env: { ...process.env, NESTFOLIO_MEMORY_DIR: join(dir, '.mem') } });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}
function runtimeExit(dir) {
  const r = spawnSync('node', ['runtime/engine/lib/run-watch.mjs', '--on=manual'], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

function classify({ row, bad, good }) {
  if (good.legacy.code !== 0 || good.runtime.code === 1) return 'good-false-positive';
  const l = bad.legacy.code !== 0;
  const r = bad.runtime.code === 1;   // runtime exit 2 (crash/registry) is NOT a catch
  if (l && r) return 'both-catch';
  if (l && !r) return 'legacy-only';
  if (!l && r) return 'runtime-only';
  return 'both-miss';
}

export async function runDifferential() {
  const fixturesRoot = join(HERE, 'fixtures/lint');
  const rows = [];
  for (const row of RULE_MAP) {
    const run = (kind) => {
      const { dir, cleanup } = buildStoreSandbox({ fixtureDir: join(fixturesRoot, row.rule, kind) });
      try { return { legacy: legacyExit(dir), runtime: runtimeExit(dir) }; } finally { cleanup(); }
    };
    const bad = run('bad'), good = run('good');
    rows.push({ rule: row.rule, checks: row.checks, mapped: row.mapped,
      class: classify({ row, bad, good }),
      legacy: { bad: bad.legacy.code, good: good.legacy.code },
      runtime: { bad: bad.runtime.code, good: good.runtime.code } });
  }
  return { rows };
}

async function main() {
  const { rows } = await runDifferential();
  for (const r of rows) console.log(`${r.rule}\t${r.class}\tlegacy bad=${r.legacy.bad} good=${r.legacy.good}\truntime bad=${r.runtime.bad} good=${r.runtime.good}`);
  const red = rows.filter((r) => r.mapped && r.class === 'legacy-only');
  process.exit(red.length ? 1 : 0);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
