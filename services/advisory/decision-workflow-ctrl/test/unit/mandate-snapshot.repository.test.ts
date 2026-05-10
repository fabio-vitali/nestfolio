import { mandateSnapshotPk, MANDATE_SNAPSHOT_SK } from '../../src/repositories/mandate-snapshot.repository';

describe('mandate-snapshot.repository', () => {
  it('builds a deterministic composite pk from tenantId + userId', () => {
    expect(mandateSnapshotPk('t', 'u')).toBe('MandateSnapshot#t#u');
  });
  it('does not collide across tenants for the same userId', () => {
    expect(mandateSnapshotPk('a', 'shared')).not.toBe(mandateSnapshotPk('b', 'shared'));
  });
  it('exports the canonical sk', () => {
    expect(MANDATE_SNAPSHOT_SK).toBe('MandateSnapshot');
  });
});
