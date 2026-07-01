import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findByScope } from '../lib/find-by-scope.mjs';
import { validCheck } from './_fixtures.mjs';

const reg = (checks) => ({ checks, byId: new Map(checks.map((c) => [c.id, c])), errors: [] });

// D1 — item scope overlaps 2 checks; 4 global invariants elsewhere → checks=2 overlapping, invariants=all 4
test('overlapping checks are scoped in; all global invariants ride the wake', () => {
  const overlap1 = validCheck({ id: 'o1', contexts: ['gate'], scope: { paths: ['services/investor-ctrl/**'] } });
  const overlap2 = validCheck({ id: 'o2', contexts: ['audit'], cost_tier: 'moderate', scope: { paths: ['services/**/*.ts'] } });
  const inv = (n) => validCheck({ id: `inv${n}`, contexts: ['invariant'], cost_tier: 'cheap', scope: { paths: ['libs/other/**'] } });
  const r = findByScope({ registry: reg([overlap1, overlap2, inv(1), inv(2), inv(3), inv(4)]), scope: ['services/investor-ctrl/src/x.ts'] });
  assert.deepEqual(r.checks.map((c) => c.id).sort(), ['o1', 'o2']);
  assert.equal(r.invariants.length, 4);
});

// D2 — expensive audit check outside scope → not returned
test('an expensive audit check outside scope is not returned', () => {
  const outside = validCheck({ id: 'x', contexts: ['audit'], cost_tier: 'expensive', scope: { paths: ['docs/**'] } });
  const r = findByScope({ registry: reg([outside]), scope: ['services/a/x.ts'] });
  assert.equal(r.checks.length, 0);
  assert.equal(r.invariants.length, 0);
});

// D3 — global invariant whose scope does NOT overlap → still returned
test('a non-overlapping global invariant is still returned (scoping narrows retrieval, never enforcement)', () => {
  const inv = validCheck({ id: 'g', contexts: ['invariant'], cost_tier: 'cheap', scope: { paths: ['nowhere/**'] } });
  const r = findByScope({ registry: reg([inv]), scope: ['services/a/x.ts'] });
  assert.equal(r.invariants.map((c) => c.id).join(), 'g');
});

// D4 — partial overlap (one glob in common, rest disjoint) → returned
test('a check partially overlapping the item scope is returned', () => {
  const c = validCheck({ id: 'p', contexts: ['gate'], scope: { paths: ['docs/**', 'services/investor-ctrl/**'] } });
  const r = findByScope({ registry: reg([c]), scope: ['libs/z/**', 'services/investor-ctrl/**'] });
  assert.equal(r.checks.map((x) => x.id).join(), 'p');
});

// non-active checks are excluded
test('non-active checks never ride the wake', () => {
  const cand = validCheck({ id: 'c', status: 'candidate', contexts: ['gate'], scope: { paths: ['services/**'] } });
  const r = findByScope({ registry: reg([cand]), scope: ['services/a'] });
  assert.equal(r.checks.length, 0);
});
