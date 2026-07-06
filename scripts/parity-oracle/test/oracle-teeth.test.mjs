// scripts/parity-oracle/test/oracle-teeth.test.mjs — sabotage each layer and assert the verdict flips.
// The instrument must provably be able to say NO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runParity } from '../run.mjs';
import { overallParity } from '../verdict.mjs';
import { buildStoreSandbox } from '../store-sandbox.mjs';

const goodRun = async () => ({ gatePass: true, numTurns: 1, costUsd: 0, rr: { perTurn: [] } });
const badRun = async () => ({ gatePass: false, numTurns: 1, costUsd: 0,
  graded: { terminalOk: false, golden: { failures: [] }, invariants: { failures: ['forbidden call-log "gh pr merge" present'] }, rubric: null },
  rr: { perTurn: [] } });

test('a runtime-side behavioral regression flips the pair and the overall verdict to RED', async () => {
  const pairs = [{ id: 'a', legacy: { id: 'a' }, runtime: { id: 'rt-a' } }];
  const rows = await runParity({ opts: { iterations: 1, runOneLegacy: goodRun, runOneRuntime: badRun }, pairs });
  assert.equal(rows[0].verdict.dominant, false);
  assert.ok(rows[0].verdict.reasons.some((r) => r.includes('gatePassRate') || r.includes('new failure class')));
  assert.equal(overallParity({ pairs: rows, differential: { rows: [] } }).green, false);
});

test('a corrupted runtime registry in a store sandbox is caught fail-closed (differential teeth)', () => {
  const fixtureDir = fileURLToPath(new URL('../fixtures/lint/r2-single-active/good/', import.meta.url));
  const { dir, cleanup } = buildStoreSandbox({ fixtureDir });
  try {
    writeFileSync(join(dir, 'runtime/content/checks/corrupt.yaml'), 'id: [unclosed\n');
    const r = spawnSync('node', ['runtime/engine/lib/run-watch.mjs', '--on=manual'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 2, `registry corruption must fail closed (exit 2), got ${r.status}: ${r.stdout} ${r.stderr}`);
  } finally { cleanup(); }
});
