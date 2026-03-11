jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
  NotRetryableError: class NotRetryableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotRetryableError';
    }
  },
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
  IdempotencyGuard: jest.fn(),
}));

import { type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { OrderFilledPipe } from '../src/pipes/order-filled.pipe';

describe('OrderFilledPipe', () => {
  const mockGetPosition = jest.fn();
  const mockUpsertPosition = jest.fn().mockResolvedValue({});

  const mockRepository = {
    getPosition: mockGetPosition,
    upsertPosition: mockUpsertPosition,
  } as any;

  let pipe: OrderFilledPipe;

  beforeEach(() => {
    jest.clearAllMocks();
    pipe = new OrderFilledPipe(mockRepository);
  });

  it('should create new position on BUY when no existing position', async () => {
    mockGetPosition.mockResolvedValue(null);

    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-1',
        type: 'ORDER_FILLED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          tenantId: 't1',
          portfolioId: 'p1',
          symbol: 'AAPL',
          side: 'BUY',
          filledQuantity: 100,
          averageFillPrice: 150,
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockGetPosition).toHaveBeenCalledWith('t1', 'p1', 'AAPL');
    // No existing position => expectedVersion is undefined
    expect(mockUpsertPosition).toHaveBeenCalledWith('t1', 'p1', 'AAPL', 100, 150, 150, undefined);
  });

  it('should update avg cost basis on BUY with existing position and pass version', async () => {
    mockGetPosition.mockResolvedValue({ quantity: 100, avgCostBasis: 100, version: 3 });

    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-2',
        type: 'ORDER_FILLED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          tenantId: 't1',
          portfolioId: 'p1',
          symbol: 'AAPL',
          side: 'BUY',
          filledQuantity: 100,
          averageFillPrice: 200,
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    // 100 shares at $100 + 100 shares at $200 = 200 shares at $150 avg cost
    expect(mockUpsertPosition).toHaveBeenCalledWith('t1', 'p1', 'AAPL', 200, 150, 200, 3);
  });

  it('should reduce quantity on SELL and keep avg cost', async () => {
    mockGetPosition.mockResolvedValue({ quantity: 100, avgCostBasis: 150, version: 2 });

    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-3',
        type: 'ORDER_FILLED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          tenantId: 't1',
          portfolioId: 'p1',
          symbol: 'AAPL',
          side: 'SELL',
          filledQuantity: 50,
          averageFillPrice: 175,
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockUpsertPosition).toHaveBeenCalledWith('t1', 'p1', 'AAPL', 50, 150, 175, 2);
  });

  it('should default to 0 when existing position has null quantity', async () => {
    mockGetPosition.mockResolvedValue({ quantity: null, avgCostBasis: null, version: 1 });

    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-null',
        type: 'ORDER_FILLED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          tenantId: 't1',
          portfolioId: 'p1',
          symbol: 'AAPL',
          side: 'BUY',
          filledQuantity: 50,
          averageFillPrice: 100,
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    // null quantity defaults to 0, so newQty = 0 + 50 = 50
    // null avgCostBasis defaults to 0, so newAvgCost = (0*0 + 50*100)/50 = 100
    expect(mockUpsertPosition).toHaveBeenCalledWith('t1', 'p1', 'AAPL', 50, 100, 100, 1);
  });

  it('should throw NotRetryableError when calculation produces NaN', async () => {
    mockGetPosition.mockResolvedValue({ quantity: 'not-a-number', avgCostBasis: 100, version: 1 });

    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-nan',
        type: 'ORDER_FILLED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          tenantId: 't1',
          portfolioId: 'p1',
          symbol: 'AAPL',
          side: 'BUY',
          filledQuantity: 50,
          averageFillPrice: 100,
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await expect(pipe.process(uow)).rejects.toThrow('NaN detected');
    expect(mockUpsertPosition).not.toHaveBeenCalled();
  });

  it('should retry on ConditionalCheckFailedException up to 3 times', async () => {
    // First attempt: version 1
    mockGetPosition.mockResolvedValueOnce({ quantity: 100, avgCostBasis: 100, version: 1 });
    const conflictError = new Error('ConditionalCheckFailedException');
    conflictError.name = 'ConditionalCheckFailedException';
    mockUpsertPosition.mockRejectedValueOnce(conflictError);

    // Second attempt (re-read): version 2 (updated by another writer)
    mockGetPosition.mockResolvedValueOnce({ quantity: 120, avgCostBasis: 110, version: 2 });
    mockUpsertPosition.mockResolvedValueOnce({});

    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-retry',
        type: 'ORDER_FILLED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          tenantId: 't1',
          portfolioId: 'p1',
          symbol: 'AAPL',
          side: 'BUY',
          filledQuantity: 50,
          averageFillPrice: 200,
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    // Should have been called twice (first failed, second succeeded)
    expect(mockGetPosition).toHaveBeenCalledTimes(2);
    expect(mockUpsertPosition).toHaveBeenCalledTimes(2);
    // Second call uses re-read values: 120 + 50 = 170 qty, weighted avg cost
    expect(mockUpsertPosition).toHaveBeenLastCalledWith(
      't1', 'p1', 'AAPL',
      170, // 120 + 50
      expect.closeTo((120 * 110 + 50 * 200) / 170, 2),
      200,
      2, // version from re-read
    );
  });
});
