import {
  PROJECTED_LEDGER_SNAPSHOT_SK,
  projectedLedgerSnapshotPk,
} from '../../src/repositories/projected-snapshot.repository';

describe('projected-snapshot.repository — LedgerSnapshot', () => {
  it('exports the static sk', () => {
    expect(PROJECTED_LEDGER_SNAPSHOT_SK).toBe('LedgerSnapshot');
  });

  it('builds pk from tenantId only', () => {
    expect(projectedLedgerSnapshotPk('tenant-abc')).toBe('LedgerSnapshot#tenant-abc');
  });
});
