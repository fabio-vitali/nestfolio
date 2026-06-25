import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJudgePrompt, parseJudgeResult } from '../judge.mjs';

test('buildJudgePrompt includes each rubric question', () => {
  const p = buildJudgePrompt({ rubric: ['Q1?', 'Q2?'] }, { result: 'r' }, 'diff');
  assert.match(p, /Q1\?/); assert.match(p, /Q2\?/);
});
test('parseJudgeResult extracts the JSON scores block', () => {
  const r = parseJudgeResult('blah\n```json\n{"scores":{"Q1?":4},"costUsd":0}\n```\n');
  assert.equal(r.scores['Q1?'], 4);
});
test('parseJudgeResult falls back to a bare {…} object when there is no fence', () => {
  const r = parseJudgeResult('Sure! {"scores":{"Q1?":5},"costUsd":0} hope that helps');
  assert.equal(r.scores['Q1?'], 5);
});
test('parseJudgeResult throws when there is no json at all (caller retries, never aborts)', () => {
  assert.throws(() => parseJudgeResult('I cannot grade this.'), /no json block/);
});
