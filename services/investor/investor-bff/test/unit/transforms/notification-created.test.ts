import { record } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { notificationCreated } from '../../../src/transforms/notification-created';

type TestUow = UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>;

function makeUow(subject: Record<string, unknown>): TestUow {
  return {
    event: {
      id: 'e1',
      type: 'NOTIFICATION_CREATED',
      timestamp: '2026-01-01T00:00:00.000Z',
      subject,
      context: { tenantId: 't1' },
    },
    payload: {},
    record: {},
  };
}

const validSubject = {
  userId: 'u1',
  tenantId: 't1',
  notificationId: 'n1',
  channel: 'email',
  title: 'Test',
  body: 'Hello',
  relatedEntityType: 'DECISION',
  relatedEntityId: 'dec-001',
};

describe('notificationCreated transform', () => {
  it('should return record intent for Notification with all contracted fields', () => {
    const uow = makeUow(validSubject);

    expect(notificationCreated(uow)).toEqual(
      record('Notification', {
        tenantId: 't1',
        userId: 'u1',
        notificationId: 'n1',
        channel: 'email',
        title: 'Test',
        body: 'Hello',
        relatedEntityType: 'DECISION',
        relatedEntityId: 'dec-001',
        status: 'CREATED',
        createdAt: '2026-01-01T00:00:00.000Z',
        read: false,
      }, {
        pk: 'InvestorProfile#t1#u1',
        sk: 'Notification#n1',
      }),
    );
  });

  it('round-trips relatedEntityType and relatedEntityId from the contract subject', () => {
    const uow = makeUow({ ...validSubject, relatedEntityType: 'ORDER', relatedEntityId: 'ord-123' });
    const result = notificationCreated(uow) as { fields: Record<string, unknown> };
    expect(result.fields['relatedEntityType']).toBe('ORDER');
    expect(result.fields['relatedEntityId']).toBe('ord-123');
  });

  it('round-trips SYSTEM entity type for circuit-breaker notifications', () => {
    const uow = makeUow({ ...validSubject, tenantId: 'SYSTEM', relatedEntityType: 'SYSTEM', relatedEntityId: 'evt-cb' });
    const result = notificationCreated(uow) as { fields: Record<string, unknown> };
    expect(result.fields['relatedEntityType']).toBe('SYSTEM');
    expect(result.fields['relatedEntityId']).toBe('evt-cb');
  });

  it('throws (parseSubject violation) when relatedEntityType is absent', () => {
    const { relatedEntityType, ...withoutType } = validSubject;
    const uow = makeUow(withoutType);
    expect(() => notificationCreated(uow)).toThrow();
  });

  it('throws (parseSubject violation) when relatedEntityId is absent', () => {
    const { relatedEntityId, ...withoutId } = validSubject;
    const uow = makeUow(withoutId);
    expect(() => notificationCreated(uow)).toThrow();
  });

  it('throws (parseSubject violation) when notificationId is absent', () => {
    const { notificationId, ...withoutNotifId } = validSubject;
    const uow = makeUow(withoutNotifId);
    expect(() => notificationCreated(uow)).toThrow();
  });
});
