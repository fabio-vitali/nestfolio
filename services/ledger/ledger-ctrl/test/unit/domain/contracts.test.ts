import {
  LedgerSnapshotSchema,
  BalanceUpdatedSchema,
  PortfolioUpdatedSchema,
  LedgerEntryRecordedSchema,
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
  it('BalanceUpdatedSchema parses a real BalanceEvent subject', () => {
    const subject = { tenantId: 't', userId: 'u', streamType: 'live', cashBalanceCents: 100_00, totalValueCents: 250_00, snapshot };
    expect(() => BalanceUpdatedSchema.parse(subject)).not.toThrow();
  });
  it('BalanceUpdatedSchema is a dry domain subject — context identity is stripped, not required', () => {
    // tenantId/userId/region travel in the event context (RequestContext), never the
    // subject. If a producer row still carries them, zod strips them; they are not required.
    const parsed = BalanceUpdatedSchema.parse({ tenantId: 't', userId: 'u1', cashBalanceCents: 100_00, snapshot });
    expect('userId' in parsed).toBe(false);
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.cashBalanceCents).toBe(100_00);
  });
  it('PortfolioUpdatedSchema parses a real PortfolioEvent subject', () => {
    const subject = { tenantId: 't', streamType: 'live', positions: snapshot.positions, positionCount: 1, totalValueCents: 250_00, snapshot };
    expect(() => PortfolioUpdatedSchema.parse(subject)).not.toThrow();
  });
  it('LedgerEntryRecordedSchema parses a real LedgerEntryEvent subject and requires snapshotAt', () => {
    const subject = { streamType: 'live', lastEventSequence: 7, snapshotAt: '2026-01-01T00:00:00.000Z', snapshot };
    expect(() => LedgerEntryRecordedSchema.parse(subject)).not.toThrow();
    expect(LedgerEntryRecordedSchema.parse(subject).snapshotAt).toBe('2026-01-01T00:00:00.000Z');
    // snapshotAt is a genuine domain field (still required); identity is not on the subject.
    const { snapshotAt: _omittedAt, ...withoutSnapshotAt } = subject;
    expect(() => LedgerEntryRecordedSchema.parse(withoutSnapshotAt)).toThrow();
  });
});
