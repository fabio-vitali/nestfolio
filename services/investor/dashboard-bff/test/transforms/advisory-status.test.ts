import { accumulate } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { advisoryStatus } from '../../src/transforms/advisory-status';

type TestUow = UnitOfWork<BusEvent<Record<string, unknown>>>;

describe('advisoryStatus transform', () => {
  const makeUow = (eventType: string): TestUow => ({
    event: {
      id: 'e1',
      type: eventType,
      timestamp: '2026-01-01T00:00:00.000Z',
      subject: {},
      context: { tenantId: 't1' },
    },
    payload: {},
    record: {},
  }) as unknown as TestUow;

  it('should increment pendingDecisions for DECISION_PACKET_CREATED', () => {
    expect(advisoryStatus(makeUow('DECISION_PACKET_CREATED'))).toEqual(
      accumulate('AdvisoryStatus', {
        field: 'pendingDecisions',
        increment: 1,
        overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
      }),
    );
  });

  it('should increment pendingDecisions for USER_CONFIRMATION_REQUESTED', () => {
    expect(advisoryStatus(makeUow('USER_CONFIRMATION_REQUESTED'))).toEqual(
      accumulate('AdvisoryStatus', {
        field: 'pendingDecisions',
        increment: 1,
        overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
      }),
    );
  });

  it('should decrement pendingDecisions for DECISION_APPROVED', () => {
    expect(advisoryStatus(makeUow('DECISION_APPROVED'))).toEqual(
      accumulate('AdvisoryStatus', {
        field: 'pendingDecisions',
        increment: -1,
        overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
      }),
    );
  });

  it('should decrement pendingDecisions for DECISION_BLOCKED', () => {
    expect(advisoryStatus(makeUow('DECISION_BLOCKED'))).toEqual(
      accumulate('AdvisoryStatus', {
        field: 'pendingDecisions',
        increment: -1,
        overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
      }),
    );
  });

  it('should return undefined for unknown event types', () => {
    expect(advisoryStatus(makeUow('UNKNOWN'))).toBeUndefined();
  });
});
