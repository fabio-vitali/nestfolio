import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runGate } from '../lib/run-gate.mjs';

const gate = (over) => ({ id: 'g', property: 'p', kind: 'drift', cost_tier: 'cheap', contexts: ['gate'],
  status: 'active', scope: { paths: ['a/**'] }, evaluator: { type: 'deterministic', run: 'cmd:true' }, provenance: { minted_by: 'x' }, ...over });
const registry = (checks) => ({ checks, byId: new Map(checks.map((c) => [c.id, c])), errors: [] });

test('a clean gate run passes', async () => {
  const r = await runGate({ registry: registry([gate({})]), boundary: 'ship', item: { id: 'i', scope: 'a/x.ts' } });
  assert.equal(r.passed, true);
  assert.deepEqual(r.findings, []);
});

test('a gate finding blocks (exit 0 ≠ pass reads the finding count)', async () => {
  const r = await runGate({ registry: registry([gate({ id: 'bad', evaluator: { type: 'deterministic', run: 'cmd:false' } })]), boundary: 'ship', item: { id: 'i', scope: 'a/x.ts' } });
  assert.equal(r.passed, false);
  assert.equal(r.findings[0].check, 'bad');
});

test('a throwing evaluator fails closed — a gap finding, not an uncaught rejection', async () => {
  const judgeCheck = gate({ id: 'j', evaluator: { type: 'judgment', run: 'skill:x' },
    flake_contract: { eval_scenario: 'x', allowed_flake_rate: 0.1, calibration: 'c' } });
  const r = await runGate({ registry: registry([judgeCheck]), boundary: 'ship', item: { id: 'i', scope: 'a/x.ts' } });   // no judge → JudgeCapabilityUnavailable
  assert.equal(r.passed, false);
  assert.equal(r.findings[0].kind, 'gap');
});
