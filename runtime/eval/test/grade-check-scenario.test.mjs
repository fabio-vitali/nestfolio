import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeCheckScenario } from '../grade-check-scenario.mjs';

const scenario = { check: 'no-ddb-scan', evaluator_kind: 'deterministic', run: 'cmd:x', kind: 'drift',
  fixtures: { good: ['good/a.ts'], bad: ['bad/b.ts', 'bad/c.ts'] }, target_pass_rate: 1 };

test('deterministic: good→0 findings & bad→≥1 finding ⇒ passRate 1', async () => {
  const runOverFixture = async (_run, path) => (path.startsWith('good/') ? [] : [{ detail: 'hit' }]);
  const r = await gradeCheckScenario(scenario, { runOverFixture });
  assert.equal(r.passRate, 1);
  assert.equal(r.pass, true);
});

test('a bad fixture that yields no finding drags the pass rate below target', async () => {
  const runOverFixture = async () => [];   // everything "clean" — the bad fixtures fail to trip
  const r = await gradeCheckScenario(scenario, { runOverFixture });
  assert.ok(r.passRate < 1);
  assert.equal(r.pass, false);
});
