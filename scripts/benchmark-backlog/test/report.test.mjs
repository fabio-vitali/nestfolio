import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagBands, renderCompare } from '../report.mjs';

test('flagBands flags a delta beyond the band', () => {
  assert.equal(flagBands(150, 100, 0.3).flagged, true);
  assert.equal(flagBands(120, 100, 0.3).flagged, false);
});
test('renderCompare marks a gate-pass-rate drop', () => {
  const md = renderCompare([{ id: 'a', a: { gatePassRate: 1, costUsd: 10 }, b: { gatePassRate: 0.66, costUsd: 8 } }]);
  assert.match(md, /REGRESSION/);
});
