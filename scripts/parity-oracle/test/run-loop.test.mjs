// scripts/parity-oracle/test/run-loop.test.mjs — runParity loop semantics with injected runners
// (no live claude): interleaving, verdict attachment, error isolation, filtering, compare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runParity, compareToBaseline } from '../run.mjs';

const fakeRun = (log, tag, gatePass) => async (s) => {
  log.push(`${tag}:${s.id}`);
  return { gatePass, numTurns: 1, costUsd: 0, rr: { perTurn: [{ input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }] } };
};

test('interleaves legacy/runtime per iteration and attaches verdicts', async () => {
  const log = [];
  const pairs = [{ id: 'a', legacy: { id: 'a' }, runtime: { id: 'rt-a' } }];
  const rows = await runParity({ opts: { iterations: 2, runOneLegacy: fakeRun(log, 'L', true), runOneRuntime: fakeRun(log, 'R', true) }, pairs });
  assert.deepEqual(log, ['L:a', 'R:rt-a', 'L:a', 'R:rt-a']);
  assert.equal(rows[0].verdict.dominant, true);
});

test('an errored pair is non-dominant and does not abort the sweep', async () => {
  const log = [];
  const good = fakeRun(log, 'L', true);
  const boom = async (s) => { if (s.id === 'bad') throw new Error('boom'); return good(s); };
  const pairs = [
    { id: 'bad', legacy: { id: 'bad' }, runtime: { id: 'rt-bad' } },
    { id: 'ok', legacy: { id: 'ok' }, runtime: { id: 'rt-ok' } },
  ];
  const rows = await runParity({ opts: { iterations: 1, runOneLegacy: boom, runOneRuntime: fakeRun(log, 'R', true) }, pairs });
  assert.equal(rows[0].verdict.dominant, false);
  assert.equal(rows[1].verdict.dominant, true);
});

test('--scenario filters pairs', async () => {
  const log = [];
  const pairs = [
    { id: 'a', legacy: { id: 'a' }, runtime: { id: 'rt-a' } },
    { id: 'b', legacy: { id: 'b' }, runtime: { id: 'rt-b' } },
  ];
  const rows = await runParity({ opts: { iterations: 1, scenario: 'b', runOneLegacy: fakeRun(log, 'L', true), runOneRuntime: fakeRun(log, 'R', true) }, pairs });
  assert.deepEqual(rows.map((r) => r.id), ['b']);
});

test('compareToBaseline flags gate drops and dominance flips; flat is clean', () => {
  const baseline = { pairs: [
    { id: 'a', runtime: { gatePassRate: 1 }, verdict: { dominant: true } },
    { id: 'b', runtime: { gatePassRate: 0.5 }, verdict: { dominant: true } },
  ] };
  const rows = [
    { id: 'a', runtime: { gatePassRate: 0.5 }, legacy: { gatePassRate: 0.5 }, verdict: { dominant: true } },
    { id: 'b', runtime: { gatePassRate: 0.5 }, legacy: { gatePassRate: 0.5 }, verdict: { dominant: true } },
  ];
  const { regressions } = compareToBaseline({ rows, baseline });
  assert.equal(regressions.length, 1);
  assert.equal(regressions[0].id, 'a');
});
