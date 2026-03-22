import { accumulate } from '@nestfolio/event-processor';
import { advisoryStatus } from '../../src/transforms/advisory-status';

describe('advisoryStatus transform', () => {
  const makeUow = (eventType: string) => ({
    event: {
      id: 'e1',
      type: eventType,
      timestamp: '2026-01-01T00:00:00.000Z',
      subject: {},
      context: { tenantId: 't1' },
    },
    payload: {},
    record: {},
  });

  it('should increment pendingDecisions for DECISION_PACKET_CREATED', () => {
    expect(advisoryStatus(makeUow('DECISION_PACKET_CREATED') as any)).toEqual(
      accumulate('AdvisoryStatus', {
        field: 'pendingDecisions',
        increment: 1,
        overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
      }),
    );
  });

  it('should increment pendingDecisions for USER_CONFIRMATION_REQUESTED', () => {
    expect(advisoryStatus(makeUow('USER_CONFIRMATION_REQUESTED') as any)).toEqual(
      accumulate('AdvisoryStatus', {
        field: 'pendingDecisions',
        increment: 1,
        overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
      }),
    );
  });

  it('should decrement pendingDecisions for DECISION_APPROVED', () => {
    expect(advisoryStatus(makeUow('DECISION_APPROVED') as any)).toEqual(
      accumulate('AdvisoryStatus', {
        field: 'pendingDecisions',
        increment: -1,
        overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
      }),
    );
  });

  it('should decrement pendingDecisions for DECISION_BLOCKED', () => {
    expect(advisoryStatus(makeUow('DECISION_BLOCKED') as any)).toEqual(
      accumulate('AdvisoryStatus', {
        field: 'pendingDecisions',
        increment: -1,
        overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
      }),
    );
  });

  it('should return undefined for unknown event types', () => {
    expect(advisoryStatus(makeUow('UNKNOWN') as any)).toBeUndefined();
  });
});
