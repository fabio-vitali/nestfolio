import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMode } from '../run.mjs';

const fakeSuite = { scenarios: [{ id: 'a', skill: 'backlog-add' }, { id: 'b', skill: 'backlog-add' }] };
test('regression runs each scenario N times', async () => {
  const calls = [];
  const out = await runMode('regression', { iterations: 2, runOne: async (s) => { calls.push(s.id); return { gatePass: true, costUsd: 1, firstTurnProseTokens: 10, numTurns: 1 }; } }, fakeSuite);
  assert.equal(calls.length, 4);
  assert.equal(out.length, 2);
});
test('--scenario filter narrows the run to explicit scenario ids', async () => {
  const calls = [];
  const out = await runMode('regression', { iterations: 1, scenario: 'b', runOne: async (s) => { calls.push(s.id); return { gatePass: true, costUsd: 1, firstTurnProseTokens: 10, numTurns: 1 }; } }, fakeSuite);
  assert.deepEqual(calls, ['b']);
  assert.equal(out.length, 1);
});
test('--scenario accepts a comma list and composes with --skill', async () => {
  const calls = [];
  const suite = { scenarios: [{ id: 'a', skill: 'backlog-add' }, { id: 'b', skill: 'backlog-add' }, { id: 'c', skill: 'backlog-next' }] };
  await runMode('regression', { iterations: 1, skill: 'backlog-add', scenario: 'a,c', runOne: async (s) => { calls.push(s.id); return { gatePass: true, costUsd: 1, firstTurnProseTokens: 10, numTurns: 1 }; } }, suite);
  assert.deepEqual(calls, ['a']); // c is excluded by --skill, b by --scenario
});
test('compare interleaves variants per iteration (A,B,A,B…)', async () => {
  const order = [];
  await runMode('compare', { iterations: 2, refA: 'main', refB: 'feat', runOne: async (s, ref) => { order.push(ref); return { gatePass: true, costUsd: 1, firstTurnProseTokens: 10, numTurns: 1 }; } }, { scenarios: [{ id: 'a', skill: 'backlog-add' }] });
  assert.deepEqual(order, ['main', 'feat', 'main', 'feat']);
});
