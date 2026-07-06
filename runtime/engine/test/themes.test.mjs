import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatherParkingSurface, shapeThemeMutations, spinOutLeftovers, themes } from '../lib/themes.mjs';

const backlog = [
  { id: 'o1', type: 'bug', status: 'parking' },
  { id: 'o2', type: 'bug', status: 'parking' },
  { id: 'active-x', type: 'feature', status: 'active' },
  { id: 'theme-a', type: 'epic', status: 'parking' },
  { id: 'old-leftovers', type: 'epic', status: 'parking' },
  { id: 'm1', type: 'bug', status: 'parking', epic: 'old-leftovers' },
];

test('gatherParkingSurface finds orphans, leftovers epics/members, and existing themes', () => {
  const g = gatherParkingSurface(backlog);
  assert.deepEqual(g.orphans.map((i) => i.id), ['o1', 'o2']);        // active + epic + leftovers-member excluded
  assert.deepEqual(g.leftoversEpics.map((i) => i.id), ['old-leftovers']);
  assert.deepEqual(g.leftoversMembers.map((i) => i.id), ['m1']);
  assert.deepEqual(g.existingThemes.map((i) => i.id), ['theme-a']);  // *-leftovers excluded from theme buckets
});

test('shapeThemeMutations mints an epic and repoints absorbed orphans as core', () => {
  const { mints, repoints } = shapeThemeMutations({ clusters: [
    { themeId: 'shared-cause', action: 'mint', absorbs: ['o1', 'o2'], rationale: 'r' },
  ] });
  assert.equal(mints.length, 1);
  assert.equal(mints[0].type, 'epic');
  assert.equal(mints[0].status, 'parking');
  assert.deepEqual(repoints, [
    { id: 'o1', epic: 'shared-cause', epic_role: 'core' },
    { id: 'o2', epic: 'shared-cause', epic_role: 'core' },
  ]);
});

test('shapeThemeMutations extend action repoints without minting', () => {
  const { mints, repoints } = shapeThemeMutations({ clusters: [
    { themeId: 'theme-a', action: 'extend', absorbs: ['o1'] },
  ] });
  assert.deepEqual(mints, []);
  assert.deepEqual(repoints, [{ id: 'o1', epic: 'theme-a', epic_role: 'core' }]);
});

test('spinOutLeftovers mints <epic>-leftovers and repoints captured members', () => {
  const { leftoversEpic, repoints } = spinOutLeftovers({ epicId: 'ep', capturedMembers: [{ id: 'c1' }, { id: 'c2' }] });
  assert.equal(leftoversEpic.id, 'ep-leftovers');
  assert.equal(leftoversEpic.type, 'epic');
  assert.deepEqual(repoints.map((r) => r.id), ['c1', 'c2']);
  assert.ok(repoints.every((r) => r.epic === 'ep-leftovers' && r.epic_role === 'core'));
});

test('spinOutLeftovers with no captured members is a no-op', () => {
  assert.deepEqual(spinOutLeftovers({ epicId: 'ep', capturedMembers: [] }), { leftoversEpic: null, repoints: [] });
});

test('themes() gathers, judges via the execute seam, and shapes mutations', async () => {
  const capabilities = { execute: async () => ({ taskId: 't', status: 'done',
    summary: JSON.stringify({ clusters: [{ themeId: 'shared-cause', action: 'mint', absorbs: ['o1', 'o2'] }] }) }) };
  const r = await themes({ backlog, capabilities });
  assert.equal(r.mints[0].id, 'shared-cause');
  assert.equal(r.repoints.length, 2);
});
