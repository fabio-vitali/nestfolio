import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCheck, parseRun, RUN_SCHEMES } from '../schema/check.schema.ts';
import { validCheck } from './_fixtures.mjs';

test('the four run-schemes are the closed set', () => {
  assert.deepEqual([...RUN_SCHEMES].sort(), ['cmd', 'eslint', 'module', 'skill']);
});

test('a full deterministic check validates', () => {
  assert.equal(validateCheck(validCheck()).ok, true);
});

test('parseRun splits scheme:target; a bare/unknown run is null', () => {
  assert.deepEqual(parseRun('cmd:node tools/x.mjs'), { scheme: 'cmd', target: 'node tools/x.mjs' });
  assert.deepEqual(parseRun('module:./m.mjs#fn'), { scheme: 'module', target: './m.mjs#fn' });
  assert.equal(parseRun('node tools/x.mjs'), null);      // bare (no scheme)
  assert.equal(parseRun('bogus:whatever'), null);        // unknown scheme
});

test('a check whose evaluator.run has no valid scheme is rejected at load', () => {
  const r = validateCheck(validCheck({ evaluator: { type: 'deterministic', run: 'node tools/x.mjs' } }));
  assert.equal(r.ok, false);
  assert.match(r.error, /run/);
});

test('a judgment check WITHOUT flake_contract is rejected (schema refuses it — §4/§8-3)', () => {
  const r = validateCheck(validCheck({
    evaluator: { type: 'judgment', run: 'skill:audit-service' }, flake_contract: undefined,
  }));
  assert.equal(r.ok, false);
  assert.match(r.error, /flake_contract/);
});

test('a judgment check WITH flake_contract validates', () => {
  const r = validateCheck(validCheck({
    kind: 'gap', cost_tier: 'expensive', contexts: ['audit'],
    evaluator: { type: 'judgment', run: 'skill:audit-service' },
    flake_contract: { eval_scenario: 'runtime/eval/scenarios/x.scenario.mjs', allowed_flake_rate: 0.05, calibration: 'n=20' },
  }));
  assert.equal(r.ok, true);
});

test('an invariant-context check may be expensive at the SCHEMA layer (cheap-by-construction is a meta-check, §8)', () => {
  assert.equal(validateCheck(validCheck({ contexts: ['invariant'], cost_tier: 'expensive' })).ok, true);
});

test('contexts must be non-empty and drawn from the frozen three', () => {
  assert.equal(validateCheck(validCheck({ contexts: [] })).ok, false);
  assert.equal(validateCheck(validCheck({ contexts: ['bogus'] })).ok, false);
});
