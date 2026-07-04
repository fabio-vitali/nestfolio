import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPreCommitGate, shouldSkip, readStaged, formatBlockLines, journalSkip, CURATE_CMD } from '../pre-commit-gate.mjs';
import { inMemoryJournal } from '../../../engine/lib/journal.mjs';

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

test('SKIP1 journalSkip appends a skip record with sha+staged under gate-skips', () => {
  const j = inMemoryJournal();
  journalSkip({ journal: j, sha: 'abc123', staged: ['a.ts'], ts: '2026-07-04T10:00:00Z' });
  const rec = j.read('gate-skips').steps.get('skip:2026-07-04T10:00:00Z');
  assert.deepEqual(rec.value, { sha: 'abc123', staged: ['a.ts'], ts: '2026-07-04T10:00:00Z' });
});

test('SKIP2 a failing ledger append propagates (fail-closed: caller must NOT honor the skip)', () => {
  const broken = { begin() {}, record() { throw new Error('disk full'); } };
  assert.throws(() => journalSkip({ journal: broken, sha: 's', staged: [], ts: 't' }), /disk full/);
});

test('MSG1 block message names curate as the sanctioned path and demotes the skip hatch', () => {
  const lines = formatBlockLines([{ id: 'no-x#0', check: 'no-x', kind: 'drift', scope: ['a.ts'], detail: 'X found', raised_at: 't' }]);
  const text = lines.join('\n');
  assert.match(text, /run-backward\.mjs curate --check no-x --trigger ship-gate/);
  assert.match(text, /last resort/i);
  assert.match(text, /journaled and adjudicated at ship/);
  assert.equal(CURATE_CMD('y'), 'node runtime/adapters/claude-code/run-backward.mjs curate --check y --trigger ship-gate');
});
