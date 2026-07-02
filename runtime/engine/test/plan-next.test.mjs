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

test('computeImpact derives blast (injected), epicPull (open core siblings), never stores', () => {
  const item = { id: 'm', status: 'active', epic: 'e', epic_role: 'core', scope: 'a/**', references: [] };
  const backlog = [item, { id: 's', status: 'queued', epic: 'e', epic_role: 'core' }, { id: 'c', status: 'queued', epic: 'e', epic_role: 'captured' }];
  const imp = computeImpact({ item, backlog, blastOf: (globs) => globs.length * 3, refResolves: () => true });
  assert.equal(imp.blast, 3);        // one glob * 3
  assert.equal(imp.epicPull, 1);     // one OPEN core sibling ('s'); 'captured' excluded
  assert.equal(imp.freshness, 'fresh');
});
