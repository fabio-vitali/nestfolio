import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseStreamJson, classifyTerminal } from '../runner.mjs';

const lines = readFileSync(new URL('./fixtures/stream-events/completed.jsonl', import.meta.url), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));

test('parseStreamJson extracts usage/cost/turns/terminalKind from a real completed stream', () => {
  const r = parseStreamJson(lines);
  assert.equal(r.terminalKind, 'completed');
  assert.ok(r.perTurn.length >= 1);
  assert.ok(typeof r.totalCostUsd === 'number');
  assert.ok(typeof r.numTurns === 'number');
});
test('classifyTerminal detects the pause sentinel', () => {
  const t = classifyTerminal({ subtype: 'success' }, 'blah\n<<HARNESS-PAUSE: need user choice>>');
  assert.equal(t.terminalKind, 'pause');
  assert.equal(t.pauseReason, 'need user choice');
});
test('classifyTerminal maps a clean finish to completed', () => {
  assert.equal(classifyTerminal({ subtype: 'success' }, 'done').terminalKind, 'completed');
});
