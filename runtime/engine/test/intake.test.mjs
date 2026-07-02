import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intake, shapeItems } from '../lib/intake.mjs';

const finding = { id: 'f1', check: 'no-x', kind: 'inconsistency', scope: ['a/b.ts'], detail: 'broke', raised_at: 't' };
const fakeCaps = (decision) => ({ execute: async () => ({ taskId: 't', status: 'done', summary: JSON.stringify(decision) }) });

test('D1: near the active epic, load-bearing → fold, one core item with from_finding', async () => {
  const d = await intake({ finding, registry: {}, backlog: [], capabilities: fakeCaps({ route: 'fold', epic: 'acme', epicRole: 'core' }) });
  assert.equal(d.route, 'fold');
  assert.equal(d.items.length, 1);
  assert.equal(d.items[0].epic_role, 'core');
  assert.equal(d.items[0].provenance.from_finding, 'f1');
  assert.equal(d.items[0].provenance.from_check, 'no-x');
});

test('D2: shares a root cause with parking orphans → mint-aggregation, an epic suggested', async () => {
  const d = await intake({ finding, registry: {}, backlog: [], capabilities: fakeCaps({ route: 'mint-aggregation', epic: 'new-theme' }) });
  assert.equal(d.route, 'mint-aggregation');
  assert.equal(d.epic, 'new-theme');
  assert.equal(d.items.length, 1);
});

test('D3: sub-parts split across the closure verdict → split into many items', async () => {
  const d = await intake({ finding, registry: {}, backlog: [], capabilities: fakeCaps({ route: 'split', splitInto: ['part-a', 'part-b'] }) });
  assert.equal(d.route, 'split');
  assert.equal(d.items.length, 2);
  assert.ok(d.items.every((i) => i.provenance.from_finding === 'f1'));
});

test('D4: an already-covered false positive → discard, zero items', async () => {
  const d = await intake({ finding, registry: {}, backlog: [], capabilities: fakeCaps({ route: 'discard' }) });
  assert.equal(d.route, 'discard');
  assert.deepEqual(d.items, []);
});
