// scripts/parity-oracle/test/suites.test.mjs — the two suites pair exactly the mapped ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSuites } from '../suites.mjs';
import { mappedIds } from '../mapping.mjs';

test('loadSuites pairs exactly the mapped ids, both sides defineSuite-shaped', async () => {
  const { legacySuite, runtimeSuite, pairs } = await loadSuites();
  assert.deepEqual(pairs.map((p) => p.id).sort(), mappedIds().sort());
  for (const suite of [legacySuite, runtimeSuite]) {
    assert.equal(typeof suite.buildSandbox, 'function');
    assert.equal(typeof suite.grade, 'function');
    assert.ok(Array.isArray(suite.scenarios) && suite.scenarios.length > 0);
  }
  for (const p of pairs) {
    assert.ok(p.legacy, `${p.id}: legacy scenario missing`);
    assert.ok(p.runtime, `${p.id}: runtime scenario missing`);
    assert.equal(p.runtime.id, `rt-${p.id}`);
    assert.equal(p.runtime.fixture, p.legacy.fixture, `${p.id}: same input store name (rtFixture may override the COPY, not the name)`);
  }
});
