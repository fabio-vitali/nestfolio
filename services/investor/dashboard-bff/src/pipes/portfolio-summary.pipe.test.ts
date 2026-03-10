jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
  IdempotencyGuard: jest.fn(),
}));

import { type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { PortfolioSummaryPipe } from './portfolio-summary.pipe';

describe('PortfolioSummaryPipe', () => {
  const mockGetPortfolioSummary = jest.fn();
  const mockUpsertPortfolioSummary = jest.fn().mockResolvedValue({});
  const mockAtomicIncrementTotalValue = jest.fn().mockResolvedValue(undefined);

  const mockRepository = {
    getPortfolioSummary: mockGetPortfolioSummary,
    upsertPortfolioSummary: mockUpsertPortfolioSummary,
    atomicIncrementTotalValue: mockAtomicIncrementTotalValue,
  } as any;

  let pipe: PortfolioSummaryPipe;

  beforeEach(() => {
    jest.clearAllMocks();
    pipe = new PortfolioSummaryPipe(mockRepository);
  });

  it('should initialize totalValueCents from first trade when no existing summary', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-1',
        type: 'ORDER_FILLED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          orderId: 'o1',
          brokerOrderId: 'bo1',
          filledQuantity: 100,
          averageFillPrice: 150.0,
          filledAt: '2025-01-01T00:00:00.000Z',
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    // 100 * 150 * 100 = 1_500_000 cents — atomic increment, no read needed
    expect(mockAtomicIncrementTotalValue).toHaveBeenCalledWith('t1', 1_500_000, {});
    expect(mockGetPortfolioSummary).not.toHaveBeenCalled();
  });

  it('should accumulate totalValueCents across subsequent trades', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-2',
        type: 'ORDER_FILLED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          orderId: 'o2',
          brokerOrderId: 'bo2',
          filledQuantity: 50,
          averageFillPrice: 200.0,
          filledAt: '2025-01-01T00:00:00.000Z',
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    // 50 * 200 * 100 = 1_000_000 cents — atomic increment handles accumulation
    expect(mockAtomicIncrementTotalValue).toHaveBeenCalledWith('t1', 1_000_000, {});
  });
});
