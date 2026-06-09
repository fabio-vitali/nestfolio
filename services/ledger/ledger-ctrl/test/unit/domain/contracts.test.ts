import {
  LedgerSnapshotSchema,
  BalanceUpdatedSchema,
  PortfolioUpdatedSchema,
  LedgerEntryRecordedSchema,
  AccountSnapshotSchema,
  TaxLotSchema,
  SnapshotHistorySchema,
  LedgerPositionSchema,
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

const position = {
  symbol: 'VTI', quantity: 50, averageCostBasis: 200,
  totalCostBasis: 10000, lastFillPrice: 210,
};

describe('ledger-ctrl AccountSnapshotSchema', () => {
  it('parses a persisted-snapshot aggregate (no identity/keys)', () => {
    const subject = {
      streamType: 'actual',
      positions: { VTI: position },
      cashBalanceCents: 500000,
      totalValueCents: 1550000,
      positionCount: 1,
      lastEventSequence: 7,
      version: 7,
      snapshotAt: '2026-06-09T00:00:00.000Z',
      timestamp: '2026-06-09T00:00:00.000Z',
    };
    expect(AccountSnapshotSchema.parse(subject)).toEqual(subject);
  });
});

describe('ledger-ctrl TaxLotSchema', () => {
  it('parses a tax-lot aggregate (no pk/sk/__typename/tenantId)', () => {
    const subject = {
      lotId: 'order1-VTI', symbol: 'VTI', quantity: 10,
      costBasisPerShare: 200, acquiredAt: '2026-06-09T00:00:00.000Z', status: 'open',
    };
    expect(TaxLotSchema.parse(subject)).toEqual(subject);
  });
  it('rejects an invalid status', () => {
    expect(() => TaxLotSchema.parse({
      lotId: 'x', symbol: 'VTI', quantity: 1, costBasisPerShare: 1,
      acquiredAt: '2026-06-09T00:00:00.000Z', status: 'frozen',
    })).toThrow();
  });
});

describe('ledger-ctrl SnapshotHistorySchema', () => {
  it('parses the append-only snapshot-history aggregate', () => {
    const subject = {
      streamType: 'actual',
      positions: { VTI: position },
      cashBalanceCents: 500000,
      lastEventSequence: 7,
    };
    expect(SnapshotHistorySchema.parse(subject)).toEqual(subject);
  });
});

it('LedgerPositionSchema is reused for snapshot positions', () => {
  expect(LedgerPositionSchema.parse(position)).toEqual(position);
});
