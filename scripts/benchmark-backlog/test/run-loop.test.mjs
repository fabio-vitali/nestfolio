import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMode } from '../run.mjs';

const fakeSuite = { scenarios: [{ id: 'a', skill: 'backlog-add' }, { id: 'b', skill: 'backlog-add' }] };
test('regression runs each scenario N times', async () => {
  const calls = [];
  const out = await runMode('regression', { iterations: 2, runOne: async (s) => { calls.push(s.id); return { gatePass: true, costUsd: 1, numTurns: 1 }; } }, fakeSuite);
  assert.equal(calls.length, 4);
  assert.equal(out.length, 2);
});
test('--scenario filter narrows the run to explicit scenario ids', async () => {
  const calls = [];
  const out = await runMode('regression', { iterations: 1, scenario: 'b', runOne: async (s) => { calls.push(s.id); return { gatePass: true, costUsd: 1, numTurns: 1 }; } }, fakeSuite);
  assert.deepEqual(calls, ['b']);
  assert.equal(out.length, 1);
});
test('--scenario accepts a comma list and composes with --skill', async () => {
  const calls = [];
  const suite = { scenarios: [{ id: 'a', skill: 'backlog-add' }, { id: 'b', skill: 'backlog-add' }, { id: 'c', skill: 'backlog-next' }] };
  await runMode('regression', { iterations: 1, skill: 'backlog-add', scenario: 'a,c', runOne: async (s) => { calls.push(s.id); return { gatePass: true, costUsd: 1, numTurns: 1 }; } }, suite);
  assert.deepEqual(calls, ['a']); // c is excluded by --skill, b by --scenario
});
test('aggregate reports per-component token totals (summed over turns, median across iterations)', async () => {
  const ins = [10, 20, 30]; let i = 0;
  const runOne = async () => ({
    gatePass: true, costUsd: 1, numTurns: 1,
    rr: { perTurn: [
      { input_tokens: ins[i++], output_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 },
      { input_tokens: 1, output_tokens: 3, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 },
    ] },
  });
  const out = await runMode('regression', { iterations: 3, runOne }, { scenarios: [{ id: 'a', skill: 'x' }] });
  assert.equal(out[0].tokens.input, 21);      // per-run input totals 11,21,31 → median 21
  assert.equal(out[0].tokens.output, 5);      // 2+3 each turn
  assert.equal(out[0].tokens.cacheRead, 150); // 100+50
  assert.equal(out[0].tokens.cacheWrite, 10); // 10+0
  assert.equal(out[0].tokens.total, 186);     // 21+5+150+10
});
test('compare interleaves variants per iteration (A,B,A,B…)', async () => {
  const order = [];
  await runMode('compare', { iterations: 2, refA: 'main', refB: 'feat', runOne: async (s, ref) => { order.push(ref); return { gatePass: true, costUsd: 1, numTurns: 1 }; } }, { scenarios: [{ id: 'a', skill: 'backlog-add' }] });
  assert.deepEqual(order, ['main', 'feat', 'main', 'feat']);
});
