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
