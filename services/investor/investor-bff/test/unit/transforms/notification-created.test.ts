import { record } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { notificationCreated } from '../../../src/transforms/notification-created';

type TestUow = UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>;

describe('notificationCreated transform', () => {
  it('should return record intent for Notification', () => {
    const uow: TestUow = {
      event: {
        id: 'e1',
        type: 'NOTIFICATION_CREATED',
        timestamp: '2026-01-01T00:00:00.000Z',
        subject: {
          userId: 'u1',
          tenantId: 't1',
          notificationId: 'n1',
          channel: 'email',
          title: 'Test',
          body: 'Hello',
          relatedEntityType: 'Order',
          relatedEntityId: 'o1',
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    expect(notificationCreated(uow)).toEqual(
      record('Notification', {
        tenantId: 't1',
        userId: 'u1',
        notificationId: 'n1',
        channel: 'email',
        title: 'Test',
        body: 'Hello',
        relatedEntityType: 'Order',
        relatedEntityId: 'o1',
        createdAt: '2026-01-01T00:00:00.000Z',
        read: false,
      }, {
        pk: 'InvestorProfile#t1#u1',
        sk: 'Notification#n1',
      }),
    );
  });
});
