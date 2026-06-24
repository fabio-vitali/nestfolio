import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  coreMembers,
  openMembers,
  isDrainable,
  selectNextMember,
  loadRecords,
  activeEpics,
  candidateEpics,
  classifyPositional,
} from '../epic-members.mjs';

test('loadRecords parses identically to the lint gate: inline comments + rank:null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'epic-members-'));
  // a core member whose status carries an inline comment — must be seen as ACTIVE
  writeFileSync(join(dir, 'm-wip.md'), `---
id: m-wip
epic: E
epic_role: core
status: active # WIP
---
`);
  // a captured member whose role carries an inline comment — must be EXCLUDED from core
  writeFileSync(join(dir, 'm-capt.md'), `---
id: m-capt
epic: E
epic_role: captured # rides along
status: queued
rank: null
---
`);
  const records = loadRecords(dir);
  const core = coreMembers(records, 'E');
  const ids = core.map(m => m.id).sort();
  assert.deepEqual(ids, ['m-wip'], 'captured(#comment) excluded; active(#comment) kept as core');
  assert.equal(core.find(m => m.id === 'm-wip').status, 'active');     // comment stripped
  assert.equal(selectNextMember(core), 'm-wip');                        // active member resumes
  rmSync(dir, { recursive: true });
});

test('coreMembers treats rank:null as undefined (sorts after explicit ranks)', () => {
  const recs = [
    { id: 'nullrank', fm: { epic: 'E', status: 'queued', rank: null, epic_role: 'core' } },
    { id: 'r2', fm: { epic: 'E', status: 'queued', rank: 2, epic_role: 'core' } },
  ];
  assert.equal(selectNextMember(coreMembers(recs, 'E')), 'r2');
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

test('activeEpics: only type:epic + status:active, sorted; ignores active non-epics and inactive epics', () => {
  const recs = [
    { id: 'epic-a', fm: { type: 'epic', status: 'active' } },
    { id: 'epic-b', fm: { type: 'epic', status: 'active' } },
    { id: 'epic-parked', fm: { type: 'epic', status: 'parking' } },     // inactive epic → excluded
    { id: 'epic-shipped', fm: { type: 'epic', status: 'shipped' } },    // terminal → excluded
    { id: 'active-member', fm: { type: 'tooling', status: 'active', epic: 'epic-a' } }, // non-epic → excluded
  ];
  assert.deepEqual(activeEpics(recs), ['epic-a', 'epic-b']);
});

test('activeEpics: none active → empty array (rule-11 guard clear)', () => {
  const recs = [
    { id: 'epic-parked', fm: { type: 'epic', status: 'parking' } },
    { id: 'item', fm: { type: 'bug', status: 'queued', rank: 1 } },
  ];
  assert.deepEqual(activeEpics(recs), []);
});

const epicRecords = [
  { id: 'E-active', fm: { type: 'epic', status: 'active', notes: 'in flight' } },
  { id: 'E-q2', fm: { type: 'epic', status: 'queued', rank: 2 } },
  { id: 'E-q1', fm: { type: 'epic', status: 'queued', rank: 1 } },
  { id: 'E-parkB', fm: { type: 'epic', status: 'parking' } },
  { id: 'E-parkA', fm: { type: 'epic', status: 'parking' } },
  { id: 'E-shipped', fm: { type: 'epic', status: 'shipped' } },
  { id: 'not-epic', fm: { type: 'bug', status: 'parking' } },
  // members of E-active: 1 open core + 1 shipped core + 1 captured (excluded from core)
  { id: 'm1', fm: { epic: 'E-active', status: 'queued', rank: 1, epic_role: 'core' } },
  { id: 'm2', fm: { epic: 'E-active', status: 'shipped', epic_role: 'core' } },
  { id: 'm3', fm: { epic: 'E-active', status: 'parking', epic_role: 'captured' } },
];

test('candidateEpics: open epics only, ordered active → queued-by-rank → parking-by-id', () => {
  const cands = candidateEpics(epicRecords);
  assert.deepEqual(
    cands.map((c) => c.id),
    ['E-active', 'E-q1', 'E-q2', 'E-parkA', 'E-parkB'],
  );
});

test('candidateEpics: annotates open/total CORE counts (captured excluded, shipped not open)', () => {
  const active = candidateEpics(epicRecords).find((c) => c.id === 'E-active');
  assert.equal(active.openCore, 1); // m1 open; m2 shipped (not open); m3 captured (not core)
  assert.equal(active.totalCore, 2); // m1 + m2
  assert.equal(active.status, 'active');
});

test('candidateEpics: excludes shipped/dropped epics and non-epic files', () => {
  const ids = candidateEpics(epicRecords).map((c) => c.id);
  assert.ok(!ids.includes('E-shipped'));
  assert.ok(!ids.includes('not-epic'));
});

test('classifyPositional: matching type:epic id → epic-id; else criterion', () => {
  assert.deepEqual(classifyPositional(epicRecords, 'E-q1'), { kind: 'epic-id', id: 'E-q1' });
  assert.deepEqual(classifyPositional(epicRecords, 'fix worst bug'), {
    kind: 'criterion',
    text: 'fix worst bug',
  });
  // a non-epic file id is NOT an epic-id → criterion (only type:epic matches)
  assert.deepEqual(classifyPositional(epicRecords, 'not-epic'), {
    kind: 'criterion',
    text: 'not-epic',
  });
});
