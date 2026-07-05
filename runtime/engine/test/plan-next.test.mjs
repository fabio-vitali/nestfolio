import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planNext, computeImpact } from '../lib/plan-next.mjs';

test('next resumes a single active item; ranked sorts queued by rank', () => {
  const backlog = [{ id: 'a', type: 'bug', status: 'active' }, { id: 'r2', type: 'bug', status: 'queued', rank: 2 }, { id: 'r1', type: 'bug', status: 'queued', rank: 1 }];
  const r = planNext({ backlog, registry: {}, env: {} });
  assert.equal(r.next, 'a');
  assert.deepEqual(r.ranked.map((i) => i.id), ['r1', 'r2']);
});

test('with no active item, next is the lowest-rank queued', () => {
  const backlog = [{ id: 'r2', type: 'bug', status: 'queued', rank: 2 }, { id: 'r1', type: 'bug', status: 'queued', rank: 1 }];
  assert.equal(planNext({ backlog, registry: {}, env: {} }).next, 'r1');
});

test('computeImpact survives object-form references ({path, anchor}) anywhere in the store', () => {
  // Mirrors docs/backlog/assemble-packet-narrative-explainability-key-mismatch.md — the store's second
  // legal citation form per ItemSchema (schema/item.schema.ts references union). Line anchors are not
  // heading anchors, so only the path reaches refResolves.
  const item = {
    id: 'my-item', status: 'queued', references: [
      { path: 'services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts', anchor: 'L83-L87' },
      'docs/backlog/other.md#heading',
    ],
  };
  const blocker = { id: 'b', status: 'queued', references: [{ path: 'docs/backlog/my-item.md' }] };
  const seen = [];
  const imp = computeImpact({ item, backlog: [item, blocker], blastOf: null, refResolves: (r) => { seen.push(r); return true; } });
  assert.equal(imp.blocks, 1);           // blocker's object-form path contains item.id — no TypeError on r.includes
  assert.equal(imp.freshness, 'fresh');
  assert.deepEqual(seen, [
    'services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts',  // object form → path string only
    'docs/backlog/other.md#heading',                                             // string form → passed through verbatim
  ]);
});

test('computeImpact derives blast (injected), epicPull (open core siblings), never stores', () => {
  const item = { id: 'm', status: 'active', epic: 'e', epic_role: 'core', scope: 'a/**', references: [] };
  const backlog = [item, { id: 's', status: 'queued', epic: 'e', epic_role: 'core' }, { id: 'c', status: 'queued', epic: 'e', epic_role: 'captured' }];
  const imp = computeImpact({ item, backlog, blastOf: (globs) => globs.length * 3, refResolves: () => true });
  assert.equal(imp.blast, 3);        // one glob * 3
  assert.equal(imp.epicPull, 1);     // one OPEN core sibling ('s'); 'captured' excluded
  assert.equal(imp.freshness, 'fresh');
});
