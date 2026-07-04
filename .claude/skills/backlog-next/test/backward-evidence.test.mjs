import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backwardEvidenceFailures } from '../postflight.mjs';

const SNAP = '2026-07-04T10:00:00.000Z';
const ledger = (recs) => ({ meta: { runId: 'backward', auto: false }, steps: new Map(recs.map((r) => [r.key, r])) });
const clean = (ts) => ({ key: 'ship:ws-1:gate-clean', status: 'complete', value: { sha: 's', base: 'origin/main', ts }, ts });
const consider = (ts) => ({ key: 'consider:ws-1', status: 'complete', value: { outcome: 'none', reason: 'r', sha: 's', ts }, ts });
const skip = (ts) => ({ key: `skip:${ts}`, status: 'complete', value: { sha: 's', staged: [], ts }, ts });

test('PF1 both records fresh → no failures', () => {
  const r = backwardEvidenceFailures({ backwardLedger: ledger([clean('2026-07-04T11:00:00Z'), consider('2026-07-04T11:01:00Z')]),
    skipsLedger: null, id: 'ws-1', snapshotTimestamp: SNAP });
  assert.deepEqual(r.failures, []);
});

test('PF2 missing gate-clean → ship-gate-evidence fails', () => {
  const r = backwardEvidenceFailures({ backwardLedger: ledger([consider('2026-07-04T11:00:00Z')]), skipsLedger: null, id: 'ws-1', snapshotTimestamp: SNAP });
  assert.equal(r.failures.some((f) => f.rule === 'ship-gate-evidence'), true);
});

test('PF3 missing consider → mint-considered fails', () => {
  const r = backwardEvidenceFailures({ backwardLedger: ledger([clean('2026-07-04T11:00:00Z')]), skipsLedger: null, id: 'ws-1', snapshotTimestamp: SNAP });
  assert.equal(r.failures.some((f) => f.rule === 'mint-considered'), true);
});

test('PF4 stale records (predate the snapshot) → both fail', () => {
  const r = backwardEvidenceFailures({ backwardLedger: ledger([clean('2026-07-04T09:00:00Z'), consider('2026-07-04T09:01:00Z')]),
    skipsLedger: null, id: 'ws-1', snapshotTimestamp: SNAP });
  assert.equal(r.failures.length, 2);
});

test('PF5 a skip postdating gate-clean → unadjudicated-skip failure', () => {
  const r = backwardEvidenceFailures({ backwardLedger: ledger([clean('2026-07-04T11:00:00Z'), consider('2026-07-04T11:01:00Z')]),
    skipsLedger: ledger([skip('2026-07-04T12:00:00Z')]), id: 'ws-1', snapshotTimestamp: SNAP });
  assert.equal(r.failures.some((f) => f.rule === 'ship-gate-evidence' && /skip/i.test(f.message)), true);
});

test('PF6 a skip BEFORE gate-clean is adjudicated → no failure', () => {
  const r = backwardEvidenceFailures({ backwardLedger: ledger([clean('2026-07-04T11:00:00Z'), consider('2026-07-04T11:01:00Z')]),
    skipsLedger: ledger([skip('2026-07-04T10:30:00Z')]), id: 'ws-1', snapshotTimestamp: SNAP });
  assert.deepEqual(r.failures, []);
});

test('PF7 no snapshot (resumed workstream) → existence-only + warning', () => {
  const r = backwardEvidenceFailures({ backwardLedger: ledger([clean('2020-01-01T00:00:00Z'), consider('2020-01-01T00:00:00Z')]),
    skipsLedger: null, id: 'ws-1', snapshotTimestamp: null });
  assert.deepEqual(r.failures, []);
  assert.equal(r.warnings.length, 1);
  const r2 = backwardEvidenceFailures({ backwardLedger: null, skipsLedger: null, id: 'ws-1', snapshotTimestamp: null });
  assert.equal(r2.failures.length, 2);                                           // records must still EXIST
});
