#!/usr/bin/env node
// scripts/parity-oracle/soak-observer.mjs — the P5 go/no-go soak instrument (spec §5). Reads the REAL
// repo journal (which the oracle's skill-less sandbox structurally cannot see) and computes the binding
// soak verdict: >=5 distinct path:runtime workstreams AND zero path:legacy-fallback AND the oracle green.
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeJournal, gitCommonDir } from '../../runtime/engine/lib/journal.mjs';
import { FALLBACK_RUN_ID, RUNTIME_PATH_KEY, isRuntimePathRecord, PATH_LEGACY_FALLBACK } from '../../runtime/engine/lib/path-provenance.mjs';

// Top-level /backlog-next(-epic) loop drivers. intake-* runs journal path:runtime for the oracle but are
// sub-workstream routings, so they do NOT count toward the ">=5 distinct workstreams" soak clause.
const WORKSTREAM_PREFIXES = ['item-', 'epic-'];

export function listRunIds(root) {
  const dir = join(root, 'journal');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
}

export function computeSoakVerdict({ journal, runIds, oracleGreen, threshold = 5 }) {
  const runtimeWorkstreams = [];
  for (const runId of runIds) {
    if (!WORKSTREAM_PREFIXES.some((p) => runId.startsWith(p))) continue;
    const step = journal.read(runId)?.steps.get(RUNTIME_PATH_KEY);
    if (isRuntimePathRecord(step)) runtimeWorkstreams.push(runId);
  }
  const fbLedger = journal.read(FALLBACK_RUN_ID);
  const fallbacks = fbLedger ? [...fbLedger.steps.values()].filter((s) => s.status === 'complete' && s.value?.path === PATH_LEGACY_FALLBACK) : [];
  const clauses = {
    enoughRuntime: runtimeWorkstreams.length >= threshold,
    zeroFallback: fallbacks.length === 0,
    oracleGreen: Boolean(oracleGreen),
  };
  return { green: clauses.enoughRuntime && clauses.zeroFallback && clauses.oracleGreen, runtimeWorkstreams, fallbacks, clauses };
}

function main() {
  // The oracle-green clause is the oracle's own job (cost-gated LLM sweep) — the operator passes its
  // result in explicitly rather than have this instrument auto-run an expensive sweep.
  const oracleGreen = process.argv.includes('--oracle-green');
  const root = gitCommonDir();
  const verdict = computeSoakVerdict({ journal: makeJournal({ root }), runIds: listRunIds(root), oracleGreen });
  console.log(JSON.stringify({
    green: verdict.green,
    clauses: verdict.clauses,
    runtimeWorkstreams: verdict.runtimeWorkstreams,
    fallbackCount: verdict.fallbacks.length,
    note: oracleGreen ? undefined : 'oracle-green not asserted; pass --oracle-green after a green live oracle sweep',
  }, null, 2));
  process.exit(verdict.green ? 0 : 1);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
