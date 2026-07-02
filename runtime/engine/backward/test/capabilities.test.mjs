import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headlessAsk, inMemoryJournal, PAUSE } from '../lib/capabilities.mjs';

test('headlessAsk returns a formal Choice whose value is the PAUSE sentinel (never a selection)', async () => {
  const choice = await headlessAsk({ id: 'mint-x', question: 'ratify?', options: [{ label: 'Ratify', value: 'ratify', recommended: true }] });
  assert.deepEqual(choice, { decisionId: 'mint-x', value: PAUSE });
});

test('inMemoryJournal is the formal Journal (step is idempotent by key)', async () => {
  const j = inMemoryJournal();
  let calls = 0;
  const a = await j.step('backward', 'mint:x:ratify', async () => { calls++; return { ok: true }; });
  const b = await j.step('backward', 'mint:x:ratify', async () => { calls++; return { ok: false }; });
  assert.deepEqual(a, { ok: true });
  assert.deepEqual(b, { ok: true });   // replay — second fn NOT run
  assert.equal(calls, 1);
});
