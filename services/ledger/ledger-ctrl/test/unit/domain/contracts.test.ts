import {
  LedgerSnapshotSchema,
  BalanceUpdatedSubjectSchema,
  PortfolioUpdatedSubjectSchema,
} from '../../../src/domain/contracts';

const snapshot = {
  positions: {
    AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 150, totalCostBasis: 1500, lastFillPrice: 155 },
  },
  cashBalanceCents: 100_00,
  lastEventSequence: 7,
};

describe('ledger-ctrl contracts', () => {
  it('LedgerSnapshotSchema parses a real snapshot', () => {
    expect(LedgerSnapshotSchema.parse(snapshot)).toMatchObject({ cashBalanceCents: 100_00 });
  });
  it('BalanceUpdatedSubjectSchema parses a real BalanceEvent subject', () => {
    const subject = { tenantId: 't', streamType: 'live', cashBalanceCents: 100_00, totalValueCents: 250_00, snapshot };
    expect(() => BalanceUpdatedSubjectSchema.parse(subject)).not.toThrow();
  });
  it('PortfolioUpdatedSubjectSchema parses a real PortfolioEvent subject', () => {
    const subject = { tenantId: 't', streamType: 'live', positions: snapshot.positions, positionCount: 1, totalValueCents: 250_00, snapshot };
    expect(() => PortfolioUpdatedSubjectSchema.parse(subject)).not.toThrow();
  });
});
