#!/usr/bin/env node
// materialize.mjs — DOGFOOD one-shot: runs the real mint procedure over the 5 lessons with a scripted
// ratify (this is the DOGFOOD materialization, NOT the interactive floor) so the committed content ring
// is genuinely the mint procedure's output. Re-runnable (idempotent). Run from repo root.
import { fileURLToPath } from 'node:url';
import { runMint } from '../lib/mint.mjs';
import { inMemoryJournal } from '../lib/capabilities.mjs';
import { DOGFOOD } from './lessons.mjs';

async function main() {
  const journal = inMemoryJournal();
  const dirs = { checksDir: 'runtime/content/checks', dossierRoot: 'runtime/content/lessons', scenariosDir: 'runtime/eval/scenarios' };
  for (const { item, lesson, proposal } of DOGFOOD) {
    const r = await runMint({ item, lesson, proposal, ask: async (d) => ({ decisionId: d.id, value: 'ratify' }), journal, ...dirs });
    if (r.kind !== 'minted') { console.error(`FAILED to mint ${proposal.id}: ${r.kind}`); process.exit(1); }
    console.log(`minted ${proposal.id} → ${dirs.checksDir}/${proposal.id}.yaml`);
  }
  console.log(`materialized ${DOGFOOD.length} checks`);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
