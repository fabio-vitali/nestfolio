import { project } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { timeTravelAvailability } from '../../src/transforms/time-travel-availability';

type TestUow = UnitOfWork<BusEvent<Record<string, unknown>>>;

describe('timeTravelAvailability transform', () => {
  const makeUow = (subject: Record<string, unknown>): TestUow => ({
    event: {
      id: 'e1',
      type: 'LEDGER_ENTRY_RECORDED',
      timestamp: '2026-01-01T00:00:00.000Z',
      subject,
      context: { tenantId: 't1' },
    },
    payload: {},
    record: {},
  }) as unknown as TestUow;

  it('should return project intent with snapshotAt from payload', () => {
    expect(timeTravelAvailability(makeUow({ snapshotAt: '2026-01-01T12:00:00.000Z' }))).toEqual(
      project('TimeTravelAvailability', {
        tenantId: 't1',
        snapshotAt: '2026-01-01T12:00:00.000Z',
      }, { pk: 'T#t1', sk: 'TimeTravelAvailability' }),
    );
  });

  it('should fall back to event timestamp when no snapshotAt', () => {
    expect(timeTravelAvailability(makeUow({}))).toEqual(
      project('TimeTravelAvailability', {
        tenantId: 't1',
        snapshotAt: '2026-01-01T00:00:00.000Z',
      }, { pk: 'T#t1', sk: 'TimeTravelAvailability' }),
    );
  });
});
