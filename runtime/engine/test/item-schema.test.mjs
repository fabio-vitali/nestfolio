import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateItem } from '../schema/item.schema.ts';

test('a minimal item validates (only id/type/status/done_criteria required)', () => {
  const r = validateItem({ id: 'x', type: 'feature', status: 'active', done_criteria: 'ships' });
  assert.equal(r.ok, true);
});

test('rank must be a number when present (the only stored priority input, law 2)', () => {
  assert.equal(validateItem({ id: 'x', type: 'bug', status: 'queued', done_criteria: 'd', rank: '3' }).ok, false);
  assert.equal(validateItem({ id: 'x', type: 'bug', status: 'queued', done_criteria: 'd', rank: 3 }).ok, true);
});

test('epic_role is constrained to core|captured', () => {
  assert.equal(validateItem({ id: 'x', type: 'feature', status: 'active', done_criteria: 'd', epic_role: 'core' }).ok, true);
  assert.equal(validateItem({ id: 'x', type: 'feature', status: 'active', done_criteria: 'd', epic_role: 'bogus' }).ok, false);
});

test('provenance.from_finding and from_check are independent optional strings', () => {
  const r = validateItem({ id: 'x', type: 'feature', status: 'active', done_criteria: 'd',
    provenance: { from_finding: 'f-1', from_check: 'read-model-single-writer' } });
  assert.equal(r.ok, true);
  assert.equal(r.value.provenance.from_finding, 'f-1');
});
