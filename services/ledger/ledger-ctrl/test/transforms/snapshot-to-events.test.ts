import { snapshotToEvents } from '../../src/transforms/snapshot-to-events';

describe('snapshotToEvents transform', () => {
  const baseSnapshot = {
    pk: 'Account#t1#actual',
    sk: 'Snapshot#latest',
    __typename: 'AccountSnapshot',
    tenantId: 't1',
    userId: 'u1',
    region: 'us-east-1',
    streamType: 'actual',
    timestamp: '2025-01-01T00:00:00.000Z',
    positions: { AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 150, totalCostBasis: 1500, lastFillPrice: 155 } },
    cashBalanceCents: 5_000_000,
    totalValueCents: 5_155_000,
    positionCount: 1,
    lastEventSequence: 5,
    version: 2,
    snapshotAt: '2025-01-01T00:00:00.000Z',
  };

  it('should emit BalanceEvent + PortfolioEvent + LedgerEntryEvent + SnapshotHistory on INSERT (no previous)', () => {
    const intents = snapshotToEvents(baseSnapshot, undefined);

    const types = intents.map((i) => i.typename);
    expect(types).toContain('BalanceEvent');
    expect(types).toContain('PortfolioEvent');
    expect(types).toContain('LedgerEntryEvent');
    expect(types).toContain('SnapshotHistory');
    expect(intents.length).toBe(4);
  });

  it('should emit only LedgerEntryEvent + SnapshotHistory when balance and positions unchanged', () => {
    const intents = snapshotToEvents(baseSnapshot, baseSnapshot);

    const types = intents.map((i) => i.typename);
    expect(types).not.toContain('BalanceEvent');
    expect(types).not.toContain('PortfolioEvent');
    expect(types).toContain('LedgerEntryEvent');
    expect(types).toContain('SnapshotHistory');
    expect(intents.length).toBe(2);
  });

  it('should emit BalanceEvent when only cash changed', () => {
    const prev = { ...baseSnapshot, cashBalanceCents: 10_000_000 };
    const intents = snapshotToEvents(baseSnapshot, prev);

    const types = intents.map((i) => i.typename);
    expect(types).toContain('BalanceEvent');
    expect(types).not.toContain('PortfolioEvent');
  });

  it('should emit PortfolioEvent when only positions changed', () => {
    const prev = { ...baseSnapshot, positions: {} };
    const intents = snapshotToEvents(baseSnapshot, prev);

    const types = intents.map((i) => i.typename);
    expect(types).not.toContain('BalanceEvent');
    expect(types).toContain('PortfolioEvent');
  });
});
