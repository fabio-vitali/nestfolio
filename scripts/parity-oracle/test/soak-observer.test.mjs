import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSoakVerdict } from '../soak-observer.mjs';

// A fake journal whose read(runId) returns a canned ledger { steps: Map }.
function fakeJournal(ledgers) {
  return { read: (runId) => ledgers[runId] ?? null };
}
const rt = (workstream) => new Map([['path:runtime', { status: 'complete', value: { path: 'runtime', workstream } }]]);
const fb = (workstream) => new Map([[`fallback:${workstream}`, { status: 'complete', value: { path: 'legacy-fallback', workstream } }]]);

test('green when >=5 runtime workstreams, zero fallbacks, oracle green', () => {
  const runIds = ['item-a', 'item-b', 'item-c', 'item-d', 'epic-e', 'intake-x'];
  const journal = fakeJournal({
    'item-a': { steps: rt('a') }, 'item-b': { steps: rt('b') }, 'item-c': { steps: rt('c') },
    'item-d': { steps: rt('d') }, 'epic-e': { steps: rt('e') }, 'intake-x': { steps: rt('x') },
    'path-fallback': { steps: new Map() },
  });
  const v = computeSoakVerdict({ journal, runIds, oracleGreen: true });
  assert.equal(v.green, true);
  assert.equal(v.runtimeWorkstreams.length, 5); // intake-* is excluded from the workstream count
});

test('not green with a fallback present', () => {
  const runIds = ['item-a', 'item-b', 'item-c', 'item-d', 'item-e'];
  const steps = Object.fromEntries(runIds.map((id) => [id, { steps: rt(id) }]));
  const journal = fakeJournal({ ...steps, 'path-fallback': { steps: fb('a') } });
  const v = computeSoakVerdict({ journal, runIds, oracleGreen: true });
  assert.equal(v.clauses.zeroFallback, false);
  assert.equal(v.green, false);
});

test('not green below threshold or when oracle red', () => {
  const runIds = ['item-a', 'item-b'];
  const journal = fakeJournal({ 'item-a': { steps: rt('a') }, 'item-b': { steps: rt('b') }, 'path-fallback': { steps: new Map() } });
  assert.equal(computeSoakVerdict({ journal, runIds, oracleGreen: true }).clauses.enoughRuntime, false);
  const five = ['item-a', 'item-b', 'item-c', 'item-d', 'item-e'];
  const j5 = fakeJournal({ ...Object.fromEntries(five.map((id) => [id, { steps: rt(id) }])), 'path-fallback': { steps: new Map() } });
  assert.equal(computeSoakVerdict({ journal: j5, runIds: five, oracleGreen: false }).green, false);
});
