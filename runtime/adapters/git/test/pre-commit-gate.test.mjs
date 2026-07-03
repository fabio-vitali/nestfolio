import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPreCommitGate, shouldSkip, readStaged } from '../pre-commit-gate.mjs';

const trigger = { on: 'commit', contexts: ['invariant', 'gate'], cost_ceiling: 'cheap' };
const registry = { checks: [], byId: new Map(), errors: [] };
// hermetic fake watch: raises a finding iff a "bad" path is in the staged (changed) scope
const fakeWatch = async ({ changedScope }) => changedScope.some((p) => p.includes('bad'))
  ? [{ id: 'no-unsafe-casts#0', check: 'no-unsafe-casts', kind: 'drift', scope: ['bad.ts'], detail: 'as any', raised_at: 't' }]
  : [];

test('a staged violation → exit 1 with the finding surfaced', async () => {
  const r = await runPreCommitGate({ stagedFiles: ['services/x/bad.ts'], registry, trigger, watch: fakeWatch });
  assert.equal(r.exitCode, 1);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].check, 'no-unsafe-casts');
});

test('a clean staged file → exit 0', async () => {
  const r = await runPreCommitGate({ stagedFiles: ['services/x/good.ts'], registry, trigger, watch: fakeWatch });
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.findings, []);
});

test('no staged files → exit 0 (nothing runs)', async () => {
  const r = await runPreCommitGate({ stagedFiles: [], registry, trigger, watch: fakeWatch });
  assert.equal(r.exitCode, 0);
});

test('RUNTIME_GATE_SKIP short-circuits the gate', () => {
  assert.equal(shouldSkip({ RUNTIME_GATE_SKIP: '1' }), true);
  assert.equal(shouldSkip({}), false);
});

test('readStaged parses the name list, dropping blank lines', () => {
  const out = readStaged(() => 'a.ts\nservices/x/b.ts\n\n');
  assert.deepEqual(out, ['a.ts', 'services/x/b.ts']);
});

// SF — the gate passes stagedFiles into watch (for attribution), alongside changedScope (for selection)
test('runPreCommitGate passes stagedFiles into watch', async () => {
  let seen;
  const watch = async (args) => { seen = args; return []; };
  await runPreCommitGate({ stagedFiles: ['libs/a/src/x.ts'], registry, trigger, watch });
  assert.deepEqual(seen.stagedFiles, ['libs/a/src/x.ts']);
  assert.deepEqual(seen.changedScope, ['libs/a/src/x.ts']);
});
