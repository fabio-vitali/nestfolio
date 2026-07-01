import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheck } from '../lib/run-check.mjs';
import { validCheck } from './_fixtures.mjs';

// E1 — context not declared → refused, zero findings (honesty rule ENFORCED)
test('a check invoked in an undeclared context is refused with context-not-declared', async () => {
  const check = validCheck({ contexts: ['audit'], evaluator: { type: 'deterministic', run: 'cmd:true' } });
  const r = await runCheck({ check, context: 'gate' });
  assert.deepEqual(r, { findings: [], ran: false, skippedReason: 'context-not-declared' });
});

// E2 — declared context → runs
test('the same check in a declared context runs', async () => {
  const check = validCheck({ contexts: ['audit'], evaluator: { type: 'deterministic', run: 'cmd:true' } });
  const r = await runCheck({ check, context: 'audit' });
  assert.equal(r.ran, true);
  assert.deepEqual(r.findings, []);
});

// E3 — evaluator raises → findings tagged with check.kind
test('a raising evaluator yields findings tagged kind===check.kind', async () => {
  const check = validCheck({ kind: 'drift', contexts: ['gate'], evaluator: { type: 'deterministic', run: 'cmd:false' } });
  const r = await runCheck({ check, context: 'gate' });
  assert.equal(r.ran, true);
  assert.ok(r.findings.length >= 1);
  assert.ok(r.findings.every((f) => f.kind === 'drift'));
});

// E4 — evaluator passes → no findings, ran:true
test('a passing evaluator yields no findings, ran:true', async () => {
  const check = validCheck({ contexts: ['gate'], evaluator: { type: 'deterministic', run: 'cmd:true' } });
  const r = await runCheck({ check, context: 'gate' });
  assert.deepEqual(r.findings, []);
  assert.equal(r.ran, true);
});
