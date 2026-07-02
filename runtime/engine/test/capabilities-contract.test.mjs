import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRecommendedWellFormed, TRIGGER_KINDS } from '../capabilities/index.ts';

test('a Decision must carry exactly one recommended option (house rule)', () => {
  const good = { id: 'd', question: 'q', options: [{ label: 'A', value: 'a', recommended: true }, { label: 'B', value: 'b' }] };
  assert.equal(isRecommendedWellFormed(good), true);
  assert.equal(isRecommendedWellFormed({ ...good, options: [{ label: 'A', value: 'a' }] }), false); // zero
  assert.equal(isRecommendedWellFormed({ ...good, options: [
    { label: 'A', value: 'a', recommended: true }, { label: 'B', value: 'b', recommended: true }] }), false); // two
});

test('TRIGGER_KINDS excludes epic-pre-done (that is a WatchTrigger-only superset kind, §4.1)', () => {
  assert.deepEqual([...TRIGGER_KINDS].sort(), ['ci', 'commit', 'manual', 'merge', 'schedule']);
});
