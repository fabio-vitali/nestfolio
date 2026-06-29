import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flagBands, renderCompare, renderEvaluation, buildReport, writeReport } from '../report.mjs';

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

test('buildReport (compare) has a header, the comparison table, and flags REGRESSION rows', () => {
  const rows = [
    { id: 'good', a: { gatePassRate: 1, costUsd: 10, tokens: { total: 1000 } }, b: { gatePassRate: 1, costUsd: 8, tokens: { total: 900 } } },
    { id: 'bad', a: { gatePassRate: 1, costUsd: 10, tokens: { total: 1000 } }, b: { gatePassRate: 0, costUsd: 4, tokens: { total: 400 } } },
  ];
  const md = buildReport({ mode: 'compare', rows, refA: 'main', refB: 'HEAD', scope: '--scenario=good,bad --iterations=1', model: 'claude-opus-4-8', generatedAt: '2026-06-29T22:00:00.000Z' });
  assert.match(md, /# benchmark-backlog compare main → HEAD/);
  assert.match(md, /Generated:.*2026-06-29/);
  assert.match(md, /--scenario=good,bad/);          // scope echoed
  assert.match(md, /1 REGRESSION row\(s\):.*bad/);   // findings summary names the regressed scenario
  assert.match(md, /## Comparison/);
  assert.match(md, /good.*value↑/s);
});

test('buildReport (compare) reports no REGRESSION rows when all gates hold', () => {
  const rows = [{ id: 'x', a: { gatePassRate: 1, costUsd: 10, tokens: { total: 1000 } }, b: { gatePassRate: 1, costUsd: 8, tokens: { total: 900 } } }];
  const md = buildReport({ mode: 'compare', rows, refA: 'main', refB: 'HEAD', generatedAt: '2026-06-29T22:00:00.000Z' });
  assert.match(md, /no REGRESSION rows/);
});

test('buildReport (regression) renders the evaluation table', () => {
  const rows = [{ id: 'a', gatePassRate: 1, costUsd: 2, tokens: { total: 12345 }, numTurns: 9 }];
  const md = buildReport({ mode: 'regression', rows, generatedAt: '2026-06-29T22:00:00.000Z' });
  assert.match(md, /# benchmark-backlog regression/);
  assert.match(md, /## Evaluation/);
  assert.match(md, /\| 12345 \|/);
});

test('writeReport writes the markdown under dir as <mode>-<sanitized-ISO>.md and returns an absolute path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bef-report-'));
  const path = writeReport({ markdown: '# hi\n', dir, mode: 'compare', generatedAt: '2026-06-29T22:00:00.000Z' });
  assert.equal(path, join(dir, 'compare-2026-06-29T22-00-00-000Z.md')); // ':' and '.' sanitized to '-'
  assert.ok(existsSync(path));
  assert.equal(readFileSync(path, 'utf8'), '# hi\n');
});
