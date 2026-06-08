import { z } from 'zod';
import { projectVersioned } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { timeTravelAvailability } from '../../../src/transforms/time-travel-availability';

type TestUow = UnitOfWork<BusEvent<Record<string, unknown>>>;

describe('timeTravelAvailability transform', () => {
  const makeUow = (subject: Record<string, unknown>): TestUow => ({
    event: {
      id: 'e1',
      type: 'LEDGER_ENTRY_RECORDED',
      timestamp: '2026-01-01T00:00:00.000Z',
      subject,
      context: { tenantId: 't1', userId: 'u1', region: 'us-east-1' },
    },
    payload: {},
    record: {},
  }) as unknown as TestUow;

  // The shape the real ledger-ctrl producer emits (LedgerEntryEvent).
  const validSubject = {
    streamType: 'actual',
    lastEventSequence: 12,
    snapshotAt: '2026-01-01T12:00:00.000Z',
    snapshot: {
      positions: { AAPL: { symbol: 'AAPL', quantity: 5, averageCostBasis: 150, totalCostBasis: 750, lastFillPrice: 150 } },
      cashBalanceCents: 250_000,
      lastEventSequence: 12,
    },
  };

  it('returns projectVersioned keyed on subject.lastEventSequence using the emitted snapshotAt', () => {
    expect(timeTravelAvailability(makeUow(validSubject))).toEqual(
      projectVersioned('TimeTravelAvailability', {
        tenantId: 't1',
        userId: 'u1',
        region: 'us-east-1',
        available: true,
        snapshotAt: '2026-01-01T12:00:00.000Z',
        latestDate: '2026-01-01',
      }, {
        version: 12,
        overrides: { pk: 'T#t1', sk: 'TimeTravelAvailability' },
      }),
    );
  });

  it('throws ZodError when lastEventSequence is absent (contract violation)', () => {
    const { lastEventSequence: _omitted, ...withoutSeq } = validSubject;
    expect(() => timeTravelAvailability(makeUow(withoutSeq))).toThrow(z.ZodError);
  });

  it('throws ZodError when snapshotAt is absent (contract violation)', () => {
    const { snapshotAt: _omitted, ...withoutSnapshotAt } = validSubject;
    expect(() => timeTravelAvailability(makeUow(withoutSnapshotAt))).toThrow(z.ZodError);
  });
});
