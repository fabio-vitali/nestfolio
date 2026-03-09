jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
  IdempotencyGuard: jest.fn(),
}));

import { type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { WithdrawalCompletedPipe } from './withdrawal-completed.pipe';

type WithdrawalCompletedPayload = {
  userId: string;
  tenantId: string;
  withdrawalId: string;
  amountCents: number;
  currency: string;
  status: string;
};

describe('WithdrawalCompletedPipe', () => {
  const mockAddNotification = jest.fn().mockResolvedValue(undefined);
  const mockRepository = { addNotification: mockAddNotification } as any;

  let pipe: WithdrawalCompletedPipe;

  beforeEach(() => {
    jest.clearAllMocks();
    pipe = new WithdrawalCompletedPipe(mockRepository);
  });

  it('should create an in-app notification for a withdrawal event', async () => {
    const uow: UnitOfWork<BusEvent<WithdrawalCompletedPayload>> = {
      event: {
        id: 'evt-1',
        type: 'WITHDRAWAL_COMPLETED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          userId: 'u1',
          tenantId: 't1',
          withdrawalId: 'wth-1',
          amountCents: 25000,
          currency: 'EUR',
          status: 'COMPLETED',
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockAddNotification).toHaveBeenCalledWith('t1', 'u1', {
      notificationId: 'wth-1',
      channel: 'IN_APP',
      title: 'Withdrawal Completed',
      body: 'Your withdrawal of 250 EUR has been completed.',
      relatedEntityType: 'Withdrawal',
      relatedEntityId: 'wth-1',
    });
  });

  it('should propagate repository errors', async () => {
    mockAddNotification.mockRejectedValueOnce(new Error('DynamoDB write failed'));

    const uow: UnitOfWork<BusEvent<WithdrawalCompletedPayload>> = {
      event: {
        id: 'evt-err',
        type: 'WITHDRAWAL_COMPLETED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          userId: 'u1',
          tenantId: 't1',
          withdrawalId: 'wth-2',
          amountCents: 5000,
          currency: 'USD',
          status: 'COMPLETED',
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await expect(pipe.process(uow)).rejects.toThrow('DynamoDB write failed');
  });
});
