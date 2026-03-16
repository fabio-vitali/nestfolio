jest.mock('@nestfolio/event-processor', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,

  requireEnv: (name: string) => process.env[name] ?? name,

}));
import { type BusEvent, type UnitOfWork } from '@nestfolio/event-processor';
import { BalanceUpdatedPipe } from '../../src/pipes/balance-updated.pipe';

type BalanceUpdatedPayload = {
  tenantId: string;
  userId: string;
  cashBalanceCents: number;
};

describe('BalanceUpdatedPipe', () => {
  const mockUpsertReadOnlyBalance = jest.fn().mockResolvedValue(undefined);
  const mockRepository = { upsertReadOnlyBalance: mockUpsertReadOnlyBalance } as any;

  let pipe: BalanceUpdatedPipe;

  beforeEach(() => {
    jest.clearAllMocks();
    pipe = new BalanceUpdatedPipe(mockRepository);
  });

  it('should call upsertReadOnlyBalance with correct args', async () => {
    const uow: UnitOfWork<BusEvent<BalanceUpdatedPayload>> = {
      event: {
        id: 'evt-1',
        type: 'BALANCE_UPDATED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          tenantId: 't1',
          userId: 'u1',
          cashBalanceCents: 1050000,
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockUpsertReadOnlyBalance).toHaveBeenCalledWith('t1', 'u1', 1050000);
  });

  it('should propagate repository errors', async () => {
    mockUpsertReadOnlyBalance.mockRejectedValueOnce(new Error('DynamoDB write failed'));

    const uow: UnitOfWork<BusEvent<BalanceUpdatedPayload>> = {
      event: {
        id: 'evt-err',
        type: 'BALANCE_UPDATED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          tenantId: 't1',
          userId: 'u1',
          cashBalanceCents: 500000,
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await expect(pipe.process(uow)).rejects.toThrow('DynamoDB write failed');
  });
});
