import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagBands, renderCompare, renderEvaluation } from '../report.mjs';

test('flagBands flags a delta beyond the band', () => {
  assert.equal(flagBands(150, 100, 0.3).flagged, true);
  assert.equal(flagBands(120, 100, 0.3).flagged, false);
});
test('renderCompare marks a gate-pass-rate drop', () => {
  const md = renderCompare([{ id: 'a', a: { gatePassRate: 1, costUsd: 10, tokens: { total: 1000 } }, b: { gatePassRate: 0.66, costUsd: 8, tokens: { total: 900 } } }]);
  assert.match(md, /REGRESSION/);
});
test('renderCompare value verdict keys off tokens.total, not costUsd', () => {
  // costUsd rises but tokens.total falls → still value↑ (tokens.total is THE signal)
  const md = renderCompare([{ id: 'a', a: { gatePassRate: 1, costUsd: 10, tokens: { total: 1000 } }, b: { gatePassRate: 1, costUsd: 12, tokens: { total: 800 } } }]);
  assert.match(md, /value↑/);
  assert.match(md, /1000→800/); // totTok column rendered from tokens.total
});
test('renderCompare reports flat when tokens.total does not drop', () => {
  const md = renderCompare([{ id: 'a', a: { gatePassRate: 1, costUsd: 10, tokens: { total: 800 } }, b: { gatePassRate: 1, costUsd: 8, tokens: { total: 900 } } }]);
  assert.match(md, /flat/);
});
test('renderEvaluation renders the totTok column from tokens.total', () => {
  const md = renderEvaluation([{ id: 'a', gatePassRate: 1, costUsd: 2, tokens: { total: 371053 }, numTurns: 9 }]);
  assert.match(md, /totTok/);          // header
  assert.match(md, /\| 371053 \|/);    // tokens.total value
  assert.doesNotMatch(md, /proseTok/);
});
