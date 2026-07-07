// runtime/engine/test/worker-pre-ship.test.mjs — the worker's pre-ship batch step is TRIGGER-driven:
// the lane→trigger mapping (Nestfolio content) is computed by the adapter and injected as `preShipTrigger`
// so ring-1 stays project-agnostic (SPEC-1 hard constraint). null trigger (doc-layer) ⇒ batch skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inMemoryJournal } from '../lib/journal.mjs';
import { runWorker } from '../loop/worker.mjs';

// capabilities whose execute completes immediately (no park), ask ships.
const caps = (journal) => ({
  journal,
  execute: async () => ({ taskId: 'i', status: 'done', summary: 'worked' }),
  ask: async () => ({ decisionId: 'ship-i', value: 'ship' }),
  runProcedure: async () => ({ status: 'done', findings: [] }),
});
const deployGateReg = (run) => ({
  checks: [{ id: 'deploy-gate', property: 'p', kind: 'gap', cost_tier: 'expensive', contexts: ['audit'],
    status: 'active', scope: { paths: ['**/*'] }, evaluator: { type: 'deterministic', run }, provenance: { minted_by: 'x' } }],
  byId: new Map(), errors: [],
});
const TRIGGER = { contexts: ['audit'], cost_ceiling: 'expensive', on: 'item-pre-ship' };  // laneToTrigger('complex')

test('WPS1 pre-ship trigger → runs the deploy-gate batch; red gate blocks ship', async () => {
  const j = inMemoryJournal();
  const item = { id: 'i', scope: 'services/**', requires_deploy: true };
  const r = await runWorker({ item, capabilities: caps(j), registry: deployGateReg('cmd:false'),
    headSha: 'S1', preShipTrigger: TRIGGER });
  assert.equal(r.status, 'failed');
  assert.match(r.summary, /pre-ship/);
  assert.equal(j.read('item-i').steps.get('e2e').value.green, false);
});

test('WPS2 null trigger (doc-layer) → batch skipped (no e2e record); ships', async () => {
  const j = inMemoryJournal();
  const item = { id: 'i', scope: 'docs/**', type: 'refactor' };
  const r = await runWorker({ item, capabilities: caps(j), registry: deployGateReg('cmd:false'),
    headSha: 'S1', preShipTrigger: null });
  assert.equal(r.status, 'done');                       // no trigger ⇒ never reaches the (red) batch
  assert.equal(j.read('item-i').steps.get('e2e'), undefined);
});

test('WPS3 pre-ship trigger, green gate → ships', async () => {
  const j = inMemoryJournal();
  const item = { id: 'i', scope: 'services/**', requires_deploy: true };
  const r = await runWorker({ item, capabilities: caps(j), registry: deployGateReg('cmd:true'),
    headSha: 'S1', preShipTrigger: TRIGGER });
  assert.equal(r.status, 'done');
  assert.equal(j.read('item-i').steps.get('e2e').value.green, true);
});
