import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCheck } from '../lib/run-check.mjs';
import { validCheck } from './_fixtures.mjs';

// E1 — context not declared → refused, zero findings (honesty rule ENFORCED)
test('a check invoked in an undeclared context is refused with context-not-declared', async () => {
  const check = validCheck({ contexts: ['audit'], evaluator: { type: 'deterministic', run: 'cmd:true' } });
  const r = await runCheck({ check, context: 'gate' });
  assert.deepEqual(r, { findings: [], ran: false, skippedReason: 'context-not-declared' });
});

// SF3 — runCheck forwards stagedFiles to the evaluator (observable via the cmd env)
test('runCheck forwards stagedFiles to the evaluator', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nf-rc-'));
  try {
    const script = join(root, 's.mjs');
    writeFileSync(script, 'process.stdout.write(process.env.RUNTIME_STAGED_PATHS ?? "<unset>"); process.exit(1);', 'utf8');
    const check = validCheck({ contexts: ['invariant'], evaluator: { type: 'deterministic', run: `cmd:node ${script}` } });
    const r = await runCheck({ check, context: 'invariant', stagedFiles: ['services/a/x.ts'] });   // in-scope (8a: env = staged∩scope)
    assert.equal(r.ran, true);
    assert.equal(r.findings[0].evidence, 'services/a/x.ts');
  } finally { rmSync(root, { recursive: true, force: true }); }
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
