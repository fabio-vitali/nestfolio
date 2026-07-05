import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readItems } from '../lib/scope-gate.mjs';

// The reconciliation's acceptance criterion, kept as a regression guard: the REAL store validates.
// (Runs from the repo root, like content-ring.test.mjs. 419 files at reconciliation time.)
test('the real docs/backlog store validates through readItems — docs/backlog IS the runtime item store', () => {
  const items = readItems('docs/backlog');
  assert.ok(items.length >= 400, `expected the full store, got ${items.length}`);
  for (const i of items) { assert.ok(i.id && i.status && i.type, `incomplete item: ${i.id}`); }
});
