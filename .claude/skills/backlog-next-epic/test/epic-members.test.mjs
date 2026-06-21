import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontmatter,
  coreMembers,
  openMembers,
  isDrainable,
  selectNextMember,
} from '../epic-members.mjs';

test('parseFrontmatter reads flat scalar fields and strips quotes', () => {
  const fm = parseFrontmatter('---\nid: foo\nstatus: queued\nepic: my-epic\nepic_role: core\nrank: 3\nnotes: "hi there"\n---\nbody');
  assert.equal(fm.id, 'foo');
  assert.equal(fm.status, 'queued');
  assert.equal(fm.epic, 'my-epic');
  assert.equal(fm.epic_role, 'core');
  assert.equal(fm.rank, '3');
  assert.equal(fm.notes, 'hi there');
});

test('parseFrontmatter returns {} when no frontmatter block', () => {
  assert.deepEqual(parseFrontmatter('no frontmatter here'), {});
});

const records = [
  { id: 'm-active', fm: { epic: 'E', status: 'active', epic_role: 'core' } },
  { id: 'm-q2', fm: { epic: 'E', status: 'queued', rank: '2', epic_role: 'core' } },
  { id: 'm-q1', fm: { epic: 'E', status: 'queued', rank: '1' } },          // role unset → core
  { id: 'm-parkB', fm: { epic: 'E', status: 'parking', epic_role: 'core' } },
  { id: 'm-parkA', fm: { epic: 'E', status: 'parking' } },                 // role unset → core
  { id: 'm-capt', fm: { epic: 'E', status: 'queued', rank: '0', epic_role: 'captured' } },
  { id: 'm-shipped', fm: { epic: 'E', status: 'shipped', epic_role: 'core' } },
  { id: 'other-epic-member', fm: { epic: 'F', status: 'queued', rank: '1', epic_role: 'core' } },
];

test('coreMembers selects role=core|unset for the epic, excludes captured + other epics', () => {
  const members = coreMembers(records, 'E').map((m) => m.id).sort();
  assert.deepEqual(members, ['m-active', 'm-parkA', 'm-parkB', 'm-q1', 'm-q2', 'm-shipped']);
  // captured + other-epic excluded
  assert.ok(!members.includes('m-capt'));
  assert.ok(!members.includes('other-epic-member'));
});

test('openMembers excludes shipped/dropped', () => {
  const open = openMembers(coreMembers(records, 'E')).map((m) => m.id);
  assert.ok(!open.includes('m-shipped'));
  assert.equal(open.length, 5);
});

test('selectNextMember: active member wins (resume the in-flight slice)', () => {
  assert.equal(selectNextMember(coreMembers(records, 'E')), 'm-active');
});

test('selectNextMember: lowest-rank queued when none active', () => {
  const noActive = coreMembers(records, 'E').filter((m) => m.status !== 'active');
  assert.equal(selectNextMember(noActive), 'm-q1'); // rank 1 (captured rank 0 is excluded by coreMembers)
});

test('selectNextMember: first parking alphabetical when no active/queued', () => {
  const parkingOnly = coreMembers(records, 'E').filter((m) => m.status === 'parking');
  assert.equal(selectNextMember(parkingOnly), 'm-parkA');
});

test('selectNextMember + isDrainable: null/drainable when only terminal members remain', () => {
  const terminal = [
    { id: 'a', status: 'shipped', role: 'core' },
    { id: 'b', status: 'dropped', role: 'core' },
  ];
  assert.equal(selectNextMember(terminal), null);
  assert.equal(isDrainable(terminal), true);
  assert.equal(isDrainable(coreMembers(records, 'E')), false);
});

test('queued ordering: missing rank sorts after explicit ranks', () => {
  const members = [
    { id: 'z-norank', status: 'queued', role: 'core' },
    { id: 'a-rank5', status: 'queued', rank: 5, role: 'core' },
  ];
  assert.equal(selectNextMember(members), 'a-rank5');
});
