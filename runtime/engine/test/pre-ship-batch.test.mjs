// runtime/engine/test/pre-ship-batch.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inMemoryJournal } from '../lib/journal.mjs';
import { preShipBatch } from '../loop/pre-ship-batch.mjs';

// a registry with one expensive audit cmd check scoped to '**/*'
const registry = (run) => ({
  checks: [{ id: 'deploy-gate', property: 'p', kind: 'gap', cost_tier: 'expensive', contexts: ['audit'],
    status: 'active', scope: { paths: ['**/*'] }, evaluator: { type: 'deterministic', run }, provenance: { minted_by: 'x' } }],
  byId: new Map(), errors: [],
});

test('PSB1 fresh (matching sha) short-circuits — no re-run', async () => {
  const j = inMemoryJournal(); const runId = 'item-x';
  j.begin(runId, { runId, auto: false });
  j.record(runId, 'e2e', { sha: 'SHA1', green: true, findings: [] });
  const f = await preShipBatch({ journal: j, runId, registry: registry('cmd:false'), changedScope: ['**/*'],
    headSha: 'SHA1', contexts: ['audit'], cost_ceiling: 'expensive', on: 'item-pre-ship' });
  assert.deepEqual(f, []);   // returned the cached findings; the cmd:false check was NOT run
});

test('PSB2 stale sha re-runs and records; green cmd → no findings', async () => {
  const j = inMemoryJournal(); const runId = 'item-y';
  j.begin(runId, { runId, auto: false });
  const f = await preShipBatch({ journal: j, runId, registry: registry('cmd:true'), changedScope: ['**/*'],
    headSha: 'SHA2', contexts: ['audit'], cost_ceiling: 'expensive', on: 'item-pre-ship' });
  assert.deepEqual(f, []);
  assert.equal(j.read(runId).steps.get('e2e').value.sha, 'SHA2');
  assert.equal(j.read(runId).steps.get('e2e').value.green, true);
});

test('PSB3 failing cmd → a finding, recorded green:false', async () => {
  const j = inMemoryJournal(); const runId = 'item-z';
  j.begin(runId, { runId, auto: false });
  const f = await preShipBatch({ journal: j, runId, registry: registry('cmd:false'), changedScope: ['**/*'],
    headSha: 'SHA3', contexts: ['audit'], cost_ceiling: 'expensive', on: 'item-pre-ship' });
  assert.equal(f.length, 1);
  assert.equal(j.read(runId).steps.get('e2e').value.green, false);
});
