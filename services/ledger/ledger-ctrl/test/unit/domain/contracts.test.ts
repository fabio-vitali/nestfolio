import {
  LedgerSnapshotSchema,
  BalanceUpdatedSubjectSchema,
  PortfolioUpdatedSubjectSchema,
  LedgerEntrySubjectSchema,
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
  it('BalanceUpdatedSubjectSchema accepts optional userId from pickRequestContext', () => {
    // userId is injected onto the DDB record by the intent executor (pickRequestContext)
    // and published as part of the subject by the changeDataCapture pipeline.
    const withUserId = { tenantId: 't', userId: 'u1', cashBalanceCents: 100_00, snapshot };
    expect(() => BalanceUpdatedSubjectSchema.parse(withUserId)).not.toThrow();
    const parsed = BalanceUpdatedSubjectSchema.parse(withUserId);
    expect(parsed.userId).toBe('u1');
  });
  it('PortfolioUpdatedSubjectSchema parses a real PortfolioEvent subject', () => {
    const subject = { tenantId: 't', streamType: 'live', positions: snapshot.positions, positionCount: 1, totalValueCents: 250_00, snapshot };
    expect(() => PortfolioUpdatedSubjectSchema.parse(subject)).not.toThrow();
  });
  it('LedgerEntrySubjectSchema parses a real LedgerEntryEvent subject and requires tenantId', () => {
    const subject = { tenantId: 't', streamType: 'live', lastEventSequence: 7, snapshot };
    expect(() => LedgerEntrySubjectSchema.parse(subject)).not.toThrow();
    const { tenantId: _omitted, ...withoutTenantId } = subject;
    expect(() => LedgerEntrySubjectSchema.parse(withoutTenantId)).toThrow();
  });
});
