import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFinding, FindingKindSchema } from '../schema/finding.schema.ts';

test('FindingKind enum is the frozen four', () => {
  assert.deepEqual([...FindingKindSchema.options].sort(), ['drift', 'gap', 'inconsistency', 'staleness']);
});

test('a well-formed finding validates', () => {
  const r = validateFinding({
    id: 'f-1', check: 'read-model-single-writer', kind: 'inconsistency',
    scope: ['services/x/src/a.ts'], detail: 'two writers disagree', raised_at: '2026-07-01T00:00:00Z',
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.evidence, undefined); // evidence is optional
});

test('a finding with an unknown kind is rejected', () => {
  const r = validateFinding({ id: 'f-2', check: 'c', kind: 'bogus', scope: [], detail: 'd', raised_at: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.error, /kind/);
});

test('a finding missing detail is rejected', () => {
  const r = validateFinding({ id: 'f-3', check: 'c', kind: 'drift', scope: [], raised_at: 'x' });
  assert.equal(r.ok, false);
});

test('a check-less (agent-observed) finding validates; AGENT_OBSERVED is exported', async () => {
  const { AGENT_OBSERVED } = await import('../schema/finding.schema.ts');
  assert.equal(AGENT_OBSERVED, 'agent-observed');
  const r = validateFinding({ id: 'f-obs', kind: 'gap', scope: ['docs/x.md'], detail: 'observed side-finding', raised_at: 't' });
  assert.equal(r.ok, true);
  assert.equal(r.value.check, undefined);
});
