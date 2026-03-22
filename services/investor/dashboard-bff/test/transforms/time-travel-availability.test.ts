import { project } from '@nestfolio/event-processor';
import { timeTravelAvailability } from '../../src/transforms/time-travel-availability';

describe('timeTravelAvailability transform', () => {
  it('should return project intent with snapshotAt from payload', () => {
    const uow = {
      event: {
        id: 'e1',
        type: 'LEDGER_ENTRY_RECORDED',
        timestamp: '2026-01-01T00:00:00.000Z',
        subject: { snapshotAt: '2026-01-01T12:00:00.000Z' },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    expect(timeTravelAvailability(uow as any)).toEqual(
      project('TimeTravelAvailability', {
        tenantId: 't1',
        snapshotAt: '2026-01-01T12:00:00.000Z',
      }, { pk: 'T#t1', sk: 'TimeTravelAvailability' }),
    );
  });

  it('should fall back to event timestamp when no snapshotAt', () => {
    const uow = {
      event: {
        id: 'e1',
        type: 'LEDGER_ENTRY_RECORDED',
        timestamp: '2026-01-01T00:00:00.000Z',
        subject: {},
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    expect(timeTravelAvailability(uow as any)).toEqual(
      project('TimeTravelAvailability', {
        tenantId: 't1',
        snapshotAt: '2026-01-01T00:00:00.000Z',
      }, { pk: 'T#t1', sk: 'TimeTravelAvailability' }),
    );
  });
});
