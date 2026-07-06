// scripts/parity-oracle/test/reuse.test.mjs — the parity oracle composes benchmark-backlog's core by
// IMPORT (never copy): these exports are the contract Tasks 6/9 build on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, defaultRunOne, runMode, PAUSE_CONVENTION } from '../../benchmark-backlog/run.mjs';

test('benchmark-backlog exports the composable core', () => {
  assert.equal(typeof aggregate, 'function');
  assert.equal(typeof defaultRunOne, 'function');
  assert.equal(typeof runMode, 'function');
  assert.ok(PAUSE_CONVENTION.includes('<<HARNESS-PAUSE:'));
});

test('aggregate math over synthetic runs', () => {
  const run = (gatePass, out) => ({ gatePass, numTurns: 5, costUsd: 1, rr: { perTurn: [{ input_tokens: 10, output_tokens: out, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }] } });
  const row = aggregate([run(true, 100), run(false, 200), run(true, 300)]);
  assert.equal(row.gatePassRate, 2 / 3);
  assert.equal(row.anyGateFlip, true);
  assert.equal(row.tokens.total, 210); // median of 110,210,310
});
