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

  it('returns projectVersioned keyed on subject.lastEventSequence', () => {
    expect(
      timeTravelAvailability(makeUow({ snapshotAt: '2026-01-01T12:00:00.000Z', lastEventSequence: 12 })),
    ).toEqual(
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

  it('falls back to event timestamp for snapshotAt', () => {
    expect(timeTravelAvailability(makeUow({ lastEventSequence: 3 }))).toEqual(
      projectVersioned('TimeTravelAvailability', {
        tenantId: 't1',
        userId: 'u1',
        region: 'us-east-1',
        available: true,
        snapshotAt: '2026-01-01T00:00:00.000Z',
        latestDate: '2026-01-01',
      }, {
        version: 3,
        overrides: { pk: 'T#t1', sk: 'TimeTravelAvailability' },
      }),
    );
  });

  it('drops (undefined) when lastEventSequence is absent', () => {
    expect(timeTravelAvailability(makeUow({ snapshotAt: '2026-01-01T12:00:00.000Z' }))).toBeUndefined();
  });
});
