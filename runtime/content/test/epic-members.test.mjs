import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectEpicMembers, activeEpics } from '../lib/epic-members.mjs';

const items = [
  { id: 'e', type: 'epic', status: 'active' },
  { id: 'other-epic', type: 'epic', status: 'active' },
  { id: 'm-active', type: 'refactor', status: 'active', epic: 'e', epic_role: 'core' },
  { id: 'm-q2', type: 'bug', status: 'queued', epic: 'e', rank: 2 },
  { id: 'm-q1', type: 'bug', status: 'queued', epic: 'e', rank: 1 },
  { id: 'm-park', type: 'bug', status: 'parking', epic: 'e' },
  { id: 'm-cap', type: 'bug', status: 'queued', epic: 'e', epic_role: 'captured' },
  { id: 'm-shipped', type: 'bug', status: 'shipped', epic: 'e', epic_role: 'core' },
  { id: 'other-member', type: 'bug', status: 'queued', epic: 'other-epic' },
];

test('selectEpicMembers: open core members of the epic, in drive order; captured + shipped + foreign excluded', () => {
  const got = selectEpicMembers(items, 'e').map((m) => m.id);
  assert.deepEqual(got, ['m-active', 'm-q1', 'm-q2', 'm-park']);   // active → queued-by-rank → parking; cap/shipped/foreign gone
});

test('selectEpicMembers: empty when the epic has no open core members', () => {
  assert.deepEqual(selectEpicMembers(items, 'no-such-epic'), []);
});

test('activeEpics: every active type:epic id, sorted', () => {
  assert.deepEqual(activeEpics(items), ['e', 'other-epic']);
});
