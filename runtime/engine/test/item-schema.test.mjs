import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateItem } from '../schema/item.schema.ts';

test('a minimal item validates (only id/type/status required — done_when requiredness is a project rule, lint 4b)', () => {
  assert.equal(validateItem({ id: 'x', type: 'feature', status: 'active' }).ok, true);
});

test('done_when is the closure predicate (reconciled 2026-07-05: identity with the store key; done_criteria is gone)', () => {
  const r = validateItem({ id: 'x', type: 'epic', status: 'active', done_when: 'ships' });
  assert.equal(r.ok, true);
  assert.equal(r.value.done_when, 'ships');
});

test('rank must be a number OR null when present (53 real files carry rank: null)', () => {
  assert.equal(validateItem({ id: 'x', type: 'bug', status: 'queued', rank: '3' }).ok, false);
  assert.equal(validateItem({ id: 'x', type: 'bug', status: 'queued', rank: 3 }).ok, true);
  assert.equal(validateItem({ id: 'x', type: 'bug', status: 'parking', rank: null }).ok, true);
});

test('epic_role is constrained to core|captured', () => {
  assert.equal(validateItem({ id: 'x', type: 'feature', status: 'active', epic_role: 'core' }).ok, true);
  assert.equal(validateItem({ id: 'x', type: 'feature', status: 'active', epic_role: 'bogus' }).ok, false);
});

test('project-local extension keys pass through PRESERVED — never stripped, never rejected', () => {
  const r = validateItem({ id: 'x', type: 'bug', status: 'shipped', spec: null, plan: 'docs/p.md',
    topic_memory: ['t.md'], validation_gate: 'evidence', closed: '2026-07-05', notes: 'n', requires_deploy: false });
  assert.equal(r.ok, true);
  assert.equal(r.value.validation_gate, 'evidence');
  assert.equal(r.value.closed, '2026-07-05');
  assert.equal(r.value.spec, null);
});

test('references accept both store citation forms — plain strings and {path, anchor} objects', () => {
  const r = validateItem({ id: 'x', type: 'bug', status: 'shipped',
    references: ['docs/a.md#section', { path: 'services/foo/src/handler.ts', anchor: 'L83-L87' }, { path: 'docs/b.md' }] });
  assert.equal(r.ok, true);
  assert.equal(r.value.references[1].anchor, 'L83-L87');
  assert.equal(validateItem({ id: 'x', type: 'bug', status: 'shipped', references: [{ anchor: 'no-path' }] }).ok, false);
});

test('provenance stays strict — ring-1 owns that sub-object (minted by intake, never hand-authored)', () => {
  const r = validateItem({ id: 'x', type: 'feature', status: 'active',
    provenance: { from_finding: 'f-1', from_check: 'read-model-single-writer' } });
  assert.equal(r.ok, true);
  assert.equal(r.value.provenance.from_finding, 'f-1');
  assert.equal(validateItem({ id: 'x', type: 'feature', status: 'active', provenance: { bogus: 'k' } }).ok, false);
});
