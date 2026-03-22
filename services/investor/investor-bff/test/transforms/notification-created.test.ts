import { record } from '@nestfolio/event-processor';
import { notificationCreated } from '../../src/transforms/notification-created';

describe('notificationCreated transform', () => {
  it('should return record intent for Notification', () => {
    const uow = {
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

    expect(notificationCreated(uow as any)).toEqual(
      record('Notification', {
        tenantId: 't1',
        userId: 'u1',
        notificationId: 'n1',
        channel: 'email',
        title: 'Test',
        body: 'Hello',
        relatedEntityType: 'Order',
        relatedEntityId: 'o1',
      }),
    );
  });
});
