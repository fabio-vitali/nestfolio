import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ruleEpicClosure, ruleEpicPointerIntegrity, ruleSingleActiveEpic,
  ruleActiveEpicFields, ruleSingleActive, epicCapturedAudit,
} from '../lib/rules.mjs';

const file = (id, fm = {}) => ({
  id, filename: `${id}.md`, path: `/dummy/${id}.md`,
  frontmatter: { id, status: 'parking', type: 'bug', notes: '', ...fm }, body: '',
});
const epic = (id, fm = {}) => file(id, { type: 'epic', ...fm });

// ── Rule 11: single active (delivery) epic ─────────────────────────────────
test('rule 11: single active epic — pass with one', () => {
  const files = [
    epic('e1', { status: 'active', done_when: 'x', scope: 'y', out_of_scope: ['z'] }),
    epic('e2', { status: 'parking' }),
  ];
  assert.deepEqual(ruleSingleActiveEpic(files), []);
});

test('rule 11: single active epic — fail with two', () => {
  const files = [epic('e1', { status: 'active' }), epic('e2', { status: 'active' })];
  const v = ruleSingleActiveEpic(files);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /multiple active epics/i);
});

// ── Rule 2 now ignores epics ───────────────────────────────────────────────
test('rule 2: an active epic + an active member do not both count as executables', () => {
  const files = [
    epic('e1', { status: 'active' }),
    file('m', { status: 'active', epic: 'e1', out_of_scope: ['x'] }),
  ];
  assert.deepEqual(ruleSingleActive(files), []);
});

// ── Rule 4 (epic variant): active epic requires done_when + scope ───────────
test('rule 4: active epic with done_when + scope — pass', () => {
  const f = epic('e1', { status: 'active', done_when: 'all core shipped', scope: 'tsc debt', out_of_scope: ['x'] });
  assert.deepEqual(ruleActiveEpicFields(f), []);
});

test('rule 4: active epic missing done_when + scope — fail (2 violations)', () => {
  const v = ruleActiveEpicFields(epic('e1', { status: 'active' }));
  assert.equal(v.length, 2);
});

test('rule 4: parking (theme) epic does not require done_when/scope', () => {
  assert.deepEqual(ruleActiveEpicFields(epic('e1', { status: 'parking' })), []);
});

// ── Rule 10: pointer integrity ─────────────────────────────────────────────
test('rule 10: member pointing at an existing epic — pass', () => {
  const files = [epic('e1', { status: 'active' }), file('m', { epic: 'e1', epic_role: 'core' })];
  assert.deepEqual(ruleEpicPointerIntegrity(files[1], files), []);
});

test('rule 10: member points at a non-existent epic — fail', () => {
  const files = [file('m', { epic: 'ghost' })];
  const v = ruleEpicPointerIntegrity(files[0], files);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /non-existent/i);
});

test('rule 10: member points at a non-epic file — fail', () => {
  const files = [file('notepic'), file('m', { epic: 'notepic' })];
  const v = ruleEpicPointerIntegrity(files[1], files);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /non-epic/i);
});

test('rule 10: epic carrying an epic pointer — fail (no nesting)', () => {
  const files = [epic('e1'), epic('e2', { epic: 'e1' })];
  const v = ruleEpicPointerIntegrity(files[1], files);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /no nested epics/i);
});

test('rule 10: invalid epic_role enum — fail', () => {
  const files = [epic('e1'), file('m', { epic: 'e1', epic_role: 'bogus' })];
  const v = ruleEpicPointerIntegrity(files[1], files);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /must be "core" or "captured"/i);
});

// ── Rule 9: epic closure ───────────────────────────────────────────────────
test('rule 9: shipped epic with all members terminal — pass', () => {
  const files = [
    epic('e1', { status: 'shipped', validation_gate: 'done' }),
    file('m1', { status: 'shipped', epic: 'e1', epic_role: 'core' }),
    file('m2', { status: 'dropped', epic: 'e1', epic_role: 'captured' }),
  ];
  assert.deepEqual(ruleEpicClosure(files[0], files), []);
});

test('rule 9: shipped epic with a non-terminal core member — fail', () => {
  const files = [
    epic('e1', { status: 'shipped', validation_gate: 'done' }),
    file('m1', { status: 'parking', epic: 'e1', epic_role: 'core' }),
  ];
  const v = ruleEpicClosure(files[0], files);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /non-terminal core member/i);
});

test('rule 9: shipped epic with an open captured member — fail (must re-home)', () => {
  const files = [
    epic('e1', { status: 'shipped', validation_gate: 'done' }),
    file('m1', { status: 'parking', epic: 'e1', epic_role: 'captured' }),
  ];
  const v = ruleEpicClosure(files[0], files);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /captured member.*leftovers/i);
});

test('rule 9: active (not shipped) epic skips the closure check', () => {
  const files = [
    epic('e1', { status: 'active' }),
    file('m1', { status: 'parking', epic: 'e1', epic_role: 'core' }),
  ];
  assert.deepEqual(ruleEpicClosure(files[0], files), []);
});

test('rule 9: DROPPED epic with a non-terminal member — fail (terminal epics also drain)', () => {
  // Previously rule 9 guarded only `shipped`, so a member of a dropped epic was
  // silent (no rollup, not an orphan). Dropped is now covered for symmetry.
  const files = [
    epic('e1', { status: 'dropped' }),
    file('m1', { status: 'parking', epic: 'e1', epic_role: 'core' }),
  ];
  const v = ruleEpicClosure(files[0], files);
  assert.equal(v.length, 1);
  assert.match(v[0].message, /dropped epic has non-terminal core member/i);
});

test('rule 9: dropped epic with all members terminal — pass (provenance pointers OK)', () => {
  const files = [
    epic('e1', { status: 'dropped' }),
    file('m1', { status: 'dropped', epic: 'e1', epic_role: 'core' }),
    file('m2', { status: 'shipped', epic: 'e1', epic_role: 'captured' }),
  ];
  assert.deepEqual(ruleEpicClosure(files[0], files), []);
});

// ── Captured-member audit surface (close-ritual aid) ───────────────────────
test('captured audit: active epic surfaces its open captured members', () => {
  const files = [
    epic('e1', { status: 'active' }),
    file('m1', { status: 'parking', epic: 'e1', epic_role: 'captured' }),
    file('m2', { status: 'queued', epic: 'e1', epic_role: 'core' }),      // core, ignored
    file('m3', { status: 'shipped', epic: 'e1', epic_role: 'captured' }), // terminal, ignored
  ];
  const audit = epicCapturedAudit(files);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].epic, 'e1');
  assert.deepEqual(audit[0].members, ['m1']);
});

test('captured audit: only ACTIVE epics are surfaced (parking theme epic ignored)', () => {
  const files = [
    epic('e1', { status: 'parking' }),
    file('m1', { status: 'parking', epic: 'e1', epic_role: 'captured' }),
  ];
  assert.deepEqual(epicCapturedAudit(files), []);
});

test('captured audit: active epic with no open captured members yields nothing', () => {
  const files = [
    epic('e1', { status: 'active' }),
    file('m1', { status: 'queued', epic: 'e1', epic_role: 'core' }),
  ];
  assert.deepEqual(epicCapturedAudit(files), []);
});
