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
    const subject = { tenantId: 't', userId: 'u', streamType: 'live', cashBalanceCents: 100_00, totalValueCents: 250_00, snapshot };
    expect(() => BalanceUpdatedSubjectSchema.parse(subject)).not.toThrow();
  });
  it('BalanceUpdatedSubjectSchema requires userId (stamped by pickRequestContext)', () => {
    // userId is always injected onto the DDB record by the intent executor and
    // published as part of the subject by the changeDataCapture pipeline, so it is
    // required — consumers use it directly in pk templates.
    const withUserId = { tenantId: 't', userId: 'u1', cashBalanceCents: 100_00, snapshot };
    expect(BalanceUpdatedSubjectSchema.parse(withUserId).userId).toBe('u1');
    const { userId: _omitted, ...withoutUserId } = withUserId;
    expect(() => BalanceUpdatedSubjectSchema.parse(withoutUserId)).toThrow();
  });
  it('PortfolioUpdatedSubjectSchema parses a real PortfolioEvent subject', () => {
    const subject = { tenantId: 't', streamType: 'live', positions: snapshot.positions, positionCount: 1, totalValueCents: 250_00, snapshot };
    expect(() => PortfolioUpdatedSubjectSchema.parse(subject)).not.toThrow();
  });
  it('LedgerEntrySubjectSchema parses a real LedgerEntryEvent subject and requires tenantId', () => {
    const subject = { tenantId: 't', streamType: 'live', lastEventSequence: 7, snapshotAt: '2026-01-01T00:00:00.000Z', snapshot };
    expect(() => LedgerEntrySubjectSchema.parse(subject)).not.toThrow();
    expect(LedgerEntrySubjectSchema.parse(subject).snapshotAt).toBe('2026-01-01T00:00:00.000Z');
    const { tenantId: _omitted, ...withoutTenantId } = subject;
    expect(() => LedgerEntrySubjectSchema.parse(withoutTenantId)).toThrow();
    const { snapshotAt: _omittedAt, ...withoutSnapshotAt } = subject;
    expect(() => LedgerEntrySubjectSchema.parse(withoutSnapshotAt)).toThrow();
  });
});
