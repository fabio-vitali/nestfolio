import { accumulate } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { advisoryStatus } from '../../../src/transforms/advisory-status';

type TestUow = UnitOfWork<BusEvent<Record<string, unknown>>>;

const TRIGGER_EVENTS = [
  'INVESTOR_PROFILE_CREATED',
  'INVESTOR_PROFILE_UPDATED',
  'PORTFOLIO_DRIFT_DETECTED',
  'ORDER_FILLED',
  'ORDER_REJECTED',
  'ORDER_CANCELLED',
  'DEPOSIT_DETECTED',
];

describe('advisoryStatus transform (post-Phase-2)', () => {
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

  TRIGGER_EVENTS.forEach((trigger) => {
    it(`increments pendingDecisionsCount on ${trigger}`, () => {
      expect(advisoryStatus(makeUow(trigger))).toEqual(
        accumulate('AdvisoryStatus', {
          field: 'pendingDecisionsCount',
          increment: 1,
          overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
        }),
      );
    });
  });

  it('decrements on DECISION_APPROVED', () => {
    expect(advisoryStatus(makeUow('DECISION_APPROVED'))).toEqual(
      accumulate('AdvisoryStatus', {
        field: 'pendingDecisionsCount',
        increment: -1,
        overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
      }),
    );
  });

  it('decrements on DECISION_BLOCKED', () => {
    expect(advisoryStatus(makeUow('DECISION_BLOCKED'))).toEqual(
      accumulate('AdvisoryStatus', {
        field: 'pendingDecisionsCount',
        increment: -1,
        overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
      }),
    );
  });

  it('does NOT increment on DECISION_PACKET_CREATED (replaced by trigger increment)', () => {
    expect(advisoryStatus(makeUow('DECISION_PACKET_CREATED'))).toBeUndefined();
  });

  it('does NOT increment on USER_CONFIRMATION_REQUESTED (was double-count)', () => {
    expect(advisoryStatus(makeUow('USER_CONFIRMATION_REQUESTED'))).toBeUndefined();
  });

  it('returns undefined for unknown event types', () => {
    expect(advisoryStatus(makeUow('UNKNOWN'))).toBeUndefined();
  });
});
