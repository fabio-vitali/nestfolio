jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
  IdempotencyGuard: jest.fn(),
}));

import { type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { DepositDetectedPipe } from './deposit-detected.pipe';

type DepositDetectedPayload = {
  userId: string;
  tenantId: string;
  depositId: string;
  amountCents: number;
  currency: string;
  status: string;
};

describe('DepositDetectedPipe', () => {
  const mockAddNotification = jest.fn().mockResolvedValue(undefined);
  const mockRepository = { addNotification: mockAddNotification } as any;

  let pipe: DepositDetectedPipe;

  beforeEach(() => {
    jest.clearAllMocks();
    pipe = new DepositDetectedPipe(mockRepository);
  });

  it('should create an in-app notification for a deposit event', async () => {
    const uow: UnitOfWork<BusEvent<DepositDetectedPayload>> = {
      event: {
        id: 'evt-1',
        type: 'DEPOSIT_DETECTED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          userId: 'u1',
          tenantId: 't1',
          depositId: 'dep-1',
          amountCents: 50000,
          currency: 'EUR',
          status: 'CONFIRMED',
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockAddNotification).toHaveBeenCalledWith('t1', 'u1', {
      notificationId: 'dep-1',
      channel: 'IN_APP',
      title: 'Deposit Detected',
      body: 'A deposit of 500 EUR has been detected.',
      relatedEntityType: 'Deposit',
      relatedEntityId: 'dep-1',
    });
  });

  it('should propagate repository errors', async () => {
    mockAddNotification.mockRejectedValueOnce(new Error('DynamoDB write failed'));

    const uow: UnitOfWork<BusEvent<DepositDetectedPayload>> = {
      event: {
        id: 'evt-err',
        type: 'DEPOSIT_DETECTED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          userId: 'u1',
          tenantId: 't1',
          depositId: 'dep-2',
          amountCents: 10000,
          currency: 'USD',
          status: 'PENDING',
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await expect(pipe.process(uow)).rejects.toThrow('DynamoDB write failed');
  });
});
