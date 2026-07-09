import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inMemoryJournal } from '../lib/journal.mjs';
import {
  RUNTIME_PATH_KEY, PATH_RUNTIME, recordRuntimePath, isRuntimePathRecord,
} from '../lib/path-provenance.mjs';

test('recordRuntimePath writes a complete path:runtime step in the workstream ledger', () => {
  const j = inMemoryJournal();
  j.begin('item-foo', { runId: 'item-foo', auto: false });
  recordRuntimePath(j, { runId: 'item-foo', workstream: 'foo', sha: 'abc123' });
  const step = j.read('item-foo').steps.get(RUNTIME_PATH_KEY);
  assert.equal(step.status, 'complete');
  assert.deepEqual(step.value, { path: PATH_RUNTIME, workstream: 'foo', sha: 'abc123' });
  assert.equal(isRuntimePathRecord(step), true);
});

test('isRuntimePathRecord is false for a non-runtime / missing step', () => {
  assert.equal(isRuntimePathRecord(undefined), false);
  assert.equal(isRuntimePathRecord({ status: 'complete', value: { path: 'legacy-fallback' } }), false);
  assert.equal(isRuntimePathRecord({ status: 'awaiting', value: { path: PATH_RUNTIME } }), false);
});
