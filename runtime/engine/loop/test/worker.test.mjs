import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWorker } from '../worker.mjs';
import { inMemoryJournal } from '../../lib/journal.mjs';

function spyCaps(overrides = {}) {
  const calls = [];
  return { calls, journal: inMemoryJournal(),
    execute: async (t) => { calls.push(['execute', t.id]); return { taskId: t.id, status: 'done', summary: 'did it' }; },
    ask: async (d) => { calls.push(['ask', d.id]); return { decisionId: d.id, value: 'ship' }; },
    fanOut: async () => { calls.push(['fanOut']); return []; },
    ...overrides };
}
const registry = { checks: [], byId: new Map(), errors: [] };   // no gates ⇒ passes

test('worker drives execute then asks to ship — never auto-merges, uses journal', async () => {
  const caps = spyCaps();
  const r = await runWorker({ item: { id: 'x', scope: 'a/**' }, capabilities: caps, registry });
  assert.equal(r.status, 'done');
  assert.deepEqual(caps.calls, [['execute', 'x'], ['ask', 'ship-x']]);   // execute → ask, no fanOut
  assert.ok(caps.journal.read('item-x'));                                // journal began
});

test('a paused execute short-circuits to paused (the floor bubbles up)', async () => {
  const caps = spyCaps({ execute: async (t) => ({ taskId: t.id, status: 'paused', summary: '<<HARNESS-PAUSE: decide>>' }) });
  const r = await runWorker({ item: { id: 'x', scope: 'a/**' }, capabilities: caps, registry });
  assert.equal(r.status, 'paused');
});
