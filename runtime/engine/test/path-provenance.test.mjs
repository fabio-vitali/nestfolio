import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inMemoryJournal } from '../lib/journal.mjs';
import {
  usesRuntimeEngine, RUNTIME_PATH_KEY, FALLBACK_RUN_ID, PATH_RUNTIME, PATH_LEGACY_FALLBACK,
  fallbackKey, recordRuntimePath, recordLegacyFallback, isRuntimePathRecord,
} from '../lib/path-provenance.mjs';

test('usesRuntimeEngine mirrors the Boolean(env.X) flag idiom', () => {
  assert.equal(usesRuntimeEngine({ RUNTIME_ENGINE: '1' }), true);
  assert.equal(usesRuntimeEngine({ RUNTIME_ENGINE: '' }), false);
  assert.equal(usesRuntimeEngine({}), false);
});

test('recordRuntimePath writes a complete path:runtime step in the workstream ledger', () => {
  const j = inMemoryJournal();
  j.begin('item-foo', { runId: 'item-foo', auto: false });
  recordRuntimePath(j, { runId: 'item-foo', workstream: 'foo', sha: 'abc123' });
  const step = j.read('item-foo').steps.get(RUNTIME_PATH_KEY);
  assert.equal(step.status, 'complete');
  assert.deepEqual(step.value, { path: PATH_RUNTIME, workstream: 'foo', sha: 'abc123' });
  assert.equal(isRuntimePathRecord(step), true);
});

test('recordLegacyFallback begins + writes to the dedicated ledger, keyed by workstream', () => {
  const j = inMemoryJournal();
  recordLegacyFallback(j, { workstream: 'bar', reason: 'runtime path blocked on X', sha: 'def456' });
  const step = j.read(FALLBACK_RUN_ID).steps.get(fallbackKey('bar'));
  assert.equal(step.status, 'complete');
  assert.equal(step.value.path, PATH_LEGACY_FALLBACK);
  assert.equal(step.value.workstream, 'bar');
  assert.equal(step.value.reason, 'runtime path blocked on X');
});

test('isRuntimePathRecord is false for a non-runtime / missing step', () => {
  assert.equal(isRuntimePathRecord(undefined), false);
  assert.equal(isRuntimePathRecord({ status: 'complete', value: { path: PATH_LEGACY_FALLBACK } }), false);
  assert.equal(isRuntimePathRecord({ status: 'awaiting', value: { path: PATH_RUNTIME } }), false);
});
