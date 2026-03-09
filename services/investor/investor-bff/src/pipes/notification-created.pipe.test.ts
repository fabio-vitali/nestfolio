jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
  IdempotencyGuard: jest.fn(),
}));

import { type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { NotificationCreatedPipe } from './notification-created.pipe';

type NotificationCreatedPayload = {
  userId: string;
  tenantId: string;
  notificationId: string;
  channel: string;
  title: string;
  body: string;
  relatedEntityType: string;
  relatedEntityId: string;
};

describe('NotificationCreatedPipe', () => {
  const mockAddNotification = jest.fn().mockResolvedValue(undefined);
  const mockRepository = { addNotification: mockAddNotification } as any;

  let pipe: NotificationCreatedPipe;

  beforeEach(() => {
    jest.clearAllMocks();
    pipe = new NotificationCreatedPipe(mockRepository);
  });

  it('should materialize a notification from NOTIFICATION_CREATED event', async () => {
    const uow: UnitOfWork<BusEvent<NotificationCreatedPayload>> = {
      event: {
        id: 'evt-1',
        type: 'NOTIFICATION_CREATED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          userId: 'u1',
          tenantId: 't1',
          notificationId: 'notif-1',
          channel: 'EMAIL',
          title: 'New advisory',
          body: 'A new advisory decision is available.',
          relatedEntityType: 'AdvisoryDecision',
          relatedEntityId: 'adv-1',
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockAddNotification).toHaveBeenCalledWith('t1', 'u1', {
      notificationId: 'notif-1',
      channel: 'EMAIL',
      title: 'New advisory',
      body: 'A new advisory decision is available.',
      relatedEntityType: 'AdvisoryDecision',
      relatedEntityId: 'adv-1',
    });
  });

  it('should propagate repository errors', async () => {
    mockAddNotification.mockRejectedValueOnce(new Error('DynamoDB write failed'));

    const uow: UnitOfWork<BusEvent<NotificationCreatedPayload>> = {
      event: {
        id: 'evt-err',
        type: 'NOTIFICATION_CREATED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          userId: 'u1',
          tenantId: 't1',
          notificationId: 'notif-2',
          channel: 'IN_APP',
          title: 'Alert',
          body: 'Something happened.',
          relatedEntityType: 'Portfolio',
          relatedEntityId: 'port-1',
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await expect(pipe.process(uow)).rejects.toThrow('DynamoDB write failed');
  });
});
