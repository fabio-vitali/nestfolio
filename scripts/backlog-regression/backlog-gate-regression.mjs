#!/usr/bin/env node
// scripts/backlog-regression/backlog-gate-regression.mjs — the runtime backlog-gate regression suite.
// Deterministic (no LLM): run the runtime commit gate over shared per-rule good/bad stores and assert
// it catches every backlog-lint violation class. Runtime = run-watch --on=commit --changed=docs/backlog/*.md
// over the seeded registry — the production cadence (diff-scoped commit gate), not a manual full sweep
// (exit 1 = findings; exit 2 = crash, which is NOT a catch). Classes: runtime-catches (bad→exit 1) |
// runtime-misses (bad→exit 0) | good-false-positive (good→exit 1).
// History: this was the runtime arm of the legacy-vs-runtime parity differential; the legacy comparator
// was retired with the legacy work-driver (runtime-legacy-retirement, 2026-07-09) and this survives
// re-pointed runtime-only, per decision D2.
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildStoreSandbox } from './store-sandbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const RULE_MAP = [
  { rule: 'r1-id-matches-filename', checks: ['backlog-id-matches-filename'], mapped: true },
  { rule: 'r2-single-active', checks: ['backlog-single-active'], mapped: true },
  { rule: 'r3-references-valid', checks: ['backlog-references-valid'], mapped: true },
  { rule: 'r4-active-out-of-scope', checks: ['backlog-active-out-of-scope'], mapped: true },
  { rule: 'r5-shipped-validation-gate', checks: ['backlog-shipped-validation-gate'], mapped: true },
  { rule: 'r6-queued-ranks', checks: ['backlog-queued-ranks'], mapped: true },
  { rule: 'r8-promotion-trigger', checks: ['backlog-promotion-trigger-gated'], mapped: true },
  // r9/r10: dedicated content checks since the P4 migration (ratified 2026-07-06) — previously
  // caught only transitively via the starter index-fresh law, which production no longer loads.
  { rule: 'r9-epic-closure', checks: ['backlog-epic-closure'], mapped: true },
  { rule: 'r10-epic-pointer', checks: ['backlog-epic-pointer-integrity'], mapped: true },
  { rule: 'r11-single-active-epic', checks: ['backlog-single-active-epic'], mapped: true },
  { rule: 'index-matches', checks: ['backlog-index-matches'], mapped: true },
  { rule: 'element-shape', checks: ['item-store-valid'], mapped: true },
];

function runtimeExit(dir) {
  const r = spawnSync('node', ['runtime/engine/lib/run-watch.mjs', '--on=commit', '--changed=docs/backlog/*.md'], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

function classify({ bad, good }) {
  if (good.code === 1) return 'good-false-positive';   // a clean store must not raise findings
  if (bad.code === 1) return 'runtime-catches';        // exit 2 (crash/registry) is NOT a catch
  return 'runtime-misses';
}

export async function runRegression() {
  const fixturesRoot = join(HERE, 'fixtures/lint');
  const rows = [];
  for (const row of RULE_MAP) {
    const run = (kind) => {
      const { dir, cleanup } = buildStoreSandbox({ fixtureDir: join(fixturesRoot, row.rule, kind) });
      try { return runtimeExit(dir); } finally { cleanup(); }
    };
    const bad = run('bad'), good = run('good');
    rows.push({ rule: row.rule, checks: row.checks, mapped: row.mapped,
      class: classify({ bad, good }), runtime: { bad: bad.code, good: good.code } });
  }
  return { rows };
}

async function main() {
  const { rows } = await runRegression();
  for (const r of rows) console.log(`${r.rule}\t${r.class}\truntime bad=${r.runtime.bad} good=${r.runtime.good}`);
  const red = rows.filter((r) => r.mapped && r.class !== 'runtime-catches');
  process.exit(red.length ? 1 : 0);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
