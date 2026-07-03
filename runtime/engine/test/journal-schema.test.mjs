import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStepRecord, validateRunMeta, STEP_STRATEGIES } from '../schema/journal.schema.ts';

test('StepRecord requires key/status/ts; status is complete|awaiting', () => {
  const ok = validateStepRecord({ key: 'E1.promote', status: 'complete', value: 42, ts: '2026-07-01T00:00:00Z' });
  assert.equal(ok.ok, true);
  const bad = validateStepRecord({ key: 'x', status: 'weird', ts: 'now' });
  assert.equal(bad.ok, false);
});

test('an awaiting step may carry a decision, a complete step a value', () => {
  const awaiting = validateStepRecord({ key: 'ship.merge', status: 'awaiting',
    decision: { id: 'd1', question: 'merge?', options: [{ label: 'Merge', value: 'merge', recommended: true }] }, ts: 't' });
  assert.equal(awaiting.ok, true);
});

test('RunMeta pins the runstate.mjs slice keys', () => {
  const ok = validateRunMeta({ runId: 'item-x', branch: 'feat/x', worktree: '.wt/x', auto: false });
  assert.equal(ok.ok, true);
  assert.equal(validateRunMeta({ runId: 'x' }).ok, false); // missing branch/worktree/auto
});

test('STEP_STRATEGIES is the closed three-value set', () => {
  assert.deepEqual([...STEP_STRATEGIES].sort(), ['external-idempotent', 'keyed-effect', 'pure-rederive']);
});

test('RF1 RunMeta accepts a locus-free run (no branch/worktree)', () => {
  const r = validateRunMeta({ runId: 'item-x', auto: false });
  assert.equal(r.ok, true);
});

test('RF2 RunMeta still rejects unknown keys', () => {
  assert.equal(validateRunMeta({ runId: 'item-x', auto: false, lane: 'complex' }).ok, false);
});
