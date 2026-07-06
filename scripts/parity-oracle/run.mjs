#!/usr/bin/env node
// scripts/parity-oracle/run.mjs — the parity oracle CLI.
// Modes: parity (live interleaved A/B over the mapped pairs + differential → verdict, exit 1 on RED)
//        differential (deterministic only, exit 1 on red mapped rules)
//        rebaseline (capture parity-baseline.json + provenance, crash-safe scratch→validate→copy)
//        compare (fresh rows vs the committed baseline, exit 1 on regression)
// Usage: node run.mjs <mode> [--scenario=id1,id2] [--iterations=N] [--model=…] [--keep]
import { writeFileSync, readFileSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregate, defaultRunOne } from '../benchmark-backlog/run.mjs';
import { writeReport } from '../benchmark-backlog/report.mjs';
import { pairVerdict, overallParity } from './verdict.mjs';
import { runDifferential } from './lint-differential.mjs';
import { buildParityReport } from './parity-report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function runParity({ opts, pairs, legacySuite, runtimeSuite }) {
  const iterations = Number(opts.iterations ?? 1);
  const runL = opts.runOneLegacy ?? defaultRunOne(legacySuite, opts);
  const runR = opts.runOneRuntime ?? defaultRunOne(runtimeSuite, opts);
  const only = opts.scenario ? new Set(String(opts.scenario).split(',').map((s) => s.trim())) : null;
  const progress = (m) => process.stderr.write(`[po] ${m}\n`);
  const rows = [];
  for (const p of pairs.filter((x) => !only || only.has(x.id))) {
    progress(`parity ${p.id} x${iterations}`);
    try {
      const a = [], b = [];
      // Interleave L,R per iteration so temporal drift is balanced across both engines.
      for (let i = 0; i < iterations; i++) { a.push(await runL(p.legacy, 'HEAD')); b.push(await runR(p.runtime, 'HEAD')); }
      const legacy = aggregate(a), runtime = aggregate(b);
      const row = { id: p.id, legacy, runtime, verdict: pairVerdict({ legacy, runtime }) };
      progress(`parity ${p.id} → legacy=${legacy.gatePassRate} runtime=${runtime.gatePassRate} dominant=${row.verdict.dominant}`);
      rows.push(row);
    } catch (e) {
      progress(`parity ${p.id} ERRORED: ${e?.message ?? e}`);
      rows.push({ id: p.id, error: String(e?.message ?? e), verdict: { dominant: false, reasons: [`errored: ${e?.message ?? e}`] } });
    }
  }
  return rows;
}

/** Regression ⇔ a pair's runtime gate dropped vs its baseline row OR its dominance flipped true→false. */
export function compareToBaseline({ rows, baseline }) {
  const base = new Map((baseline.pairs ?? []).map((p) => [p.id, p]));
  const regressions = [];
  for (const r of rows) {
    const b = base.get(r.id);
    if (!b) continue;   // new pair — reported, never a regression
    if (r.error) { regressions.push({ id: r.id, reason: `errored: ${r.error}` }); continue; }
    if (r.runtime.gatePassRate < b.runtime.gatePassRate) regressions.push({ id: r.id, reason: `runtime gate ${b.runtime.gatePassRate} → ${r.runtime.gatePassRate}` });
    else if (b.verdict?.dominant && !r.verdict.dominant) regressions.push({ id: r.id, reason: `dominance flipped: ${r.verdict.reasons.join('; ')}` });
  }
  return { regressions };
}

function writeBaseline({ rows, differential, opts, generatedAt }) {
  const scratch = join(tmpdir(), `parity-baseline-${process.pid}.json`);
  writeFileSync(scratch, JSON.stringify({ pairs: rows, differential: differential.rows }, null, 2));
  JSON.parse(readFileSync(scratch, 'utf8'));   // validate before touching the committed file
  cpSync(scratch, join(HERE, 'parity-baseline.json'));
  writeFileSync(join(HERE, 'parity-baseline.provenance.json'), JSON.stringify({
    generatedAt, model: opts.model ?? 'claude-opus-4-8', iterations: Number(opts.iterations ?? 1),
    sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: HERE, encoding: 'utf8' }).trim(),
  }, null, 2) + '\n');
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const opts = Object.fromEntries(
    rest.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
  if (!['parity', 'differential', 'rebaseline', 'compare'].includes(mode)) {
    console.error('usage: run.mjs <parity|differential|rebaseline|compare> [--scenario=id1,id2] [--iterations=N] [--model=…] [--keep]');
    process.exit(2);
  }
  const generatedAt = new Date().toISOString();
  const scope = [opts.scenario && `--scenario=${opts.scenario}`, `--iterations=${Number(opts.iterations ?? 1)}`].filter(Boolean).join(' ');
  const report = (payload) => {
    try {
      const markdown = buildParityReport({ mode, generatedAt, scope, model: opts.model, ...payload });
      const path = writeReport({ markdown, dir: join(process.cwd(), 'benchmarks', 'parity-oracle'), mode, generatedAt });
      console.error(`[po] report written: ${path}`);
    } catch (e) { console.error(`[po] WARN: failed to write report: ${e.message}`); }
  };

  if (mode === 'differential') {
    const differential = await runDifferential();
    const parity = overallParity({ pairs: [], differential });
    report({ differential, parity });
    console.log(JSON.stringify(differential.rows, null, 2));
    process.exit(parity.green ? 0 : 1);
  }

  const { loadSuites } = await import('./suites.mjs');
  const { legacySuite, runtimeSuite, pairs } = await loadSuites();
  const rows = await runParity({ opts, pairs, legacySuite, runtimeSuite });
  const differential = await runDifferential();
  const parity = overallParity({ pairs: rows, differential });

  if (mode === 'rebaseline') {
    writeBaseline({ rows, differential, opts, generatedAt });
    report({ rows, differential, parity });
    console.log(JSON.stringify({ pairs: rows.length, parity }, null, 2));
    process.exit(0);
  }
  if (mode === 'compare') {
    const baseline = JSON.parse(readFileSync(join(HERE, 'parity-baseline.json'), 'utf8'));
    const { regressions } = compareToBaseline({ rows, baseline });
    report({ rows, differential, parity });
    console.log(JSON.stringify({ regressions, parity }, null, 2));
    process.exit(regressions.length ? 1 : 0);
  }
  // parity
  report({ rows, differential, parity });
  console.log(JSON.stringify({ rows, parity }, null, 2));
  process.exit(parity.green ? 0 : 1);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
