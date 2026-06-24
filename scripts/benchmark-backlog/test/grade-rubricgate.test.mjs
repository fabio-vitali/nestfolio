import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rubricGatePasses } from '../grade.mjs';

test('no rubricGate → rubric is informational (always passes)', () => {
  assert.equal(rubricGatePasses(null, undefined), true);
  assert.equal(rubricGatePasses({ scores: { q: 1 } }, undefined), true);
});

test('rubricGate passes when every dimension meets the minimum', () => {
  assert.equal(rubricGatePasses({ scores: { a: 4, b: 5 } }, 4), true);
});

test('rubricGate fails when any dimension is below the minimum', () => {
  assert.equal(rubricGatePasses({ scores: { a: 4, b: 2 } }, 4), false);
});

test('rubricGate fails when the rubric is missing (judge required but absent)', () => {
  assert.equal(rubricGatePasses(null, 4), false);
  assert.equal(rubricGatePasses({}, 4), false);
});
