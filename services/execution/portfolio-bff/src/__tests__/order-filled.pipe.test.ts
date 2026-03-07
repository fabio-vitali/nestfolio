jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  IdempotencyGuard: jest.fn(),
}));

import Highland from 'highland';
import { type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { OrderFilledPipe } from '../pipes/order-filled.pipe';

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

  it('should create new position on BUY when no existing position', (done) => {
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

    const source = Highland<UnitOfWork<BusEvent<any>>>([uow]);

    pipe.feed(source).done(() => {
      expect(mockGetPosition).toHaveBeenCalledWith('t1', 'p1', 'AAPL');
      expect(mockUpsertPosition).toHaveBeenCalledWith('t1', 'p1', 'AAPL', 100, 150, 150);
      done();
    });
  });

  it('should update avg cost basis on BUY with existing position', (done) => {
    mockGetPosition.mockResolvedValue({ quantity: 100, avgCostBasis: 100 });

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

    const source = Highland<UnitOfWork<BusEvent<any>>>([uow]);

    pipe.feed(source).done(() => {
      // 100 shares at $100 + 100 shares at $200 = 200 shares at $150 avg cost
      expect(mockUpsertPosition).toHaveBeenCalledWith('t1', 'p1', 'AAPL', 200, 150, 200);
      done();
    });
  });

  it('should reduce quantity on SELL and keep avg cost', (done) => {
    mockGetPosition.mockResolvedValue({ quantity: 100, avgCostBasis: 150 });

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

    const source = Highland<UnitOfWork<BusEvent<any>>>([uow]);

    pipe.feed(source).done(() => {
      expect(mockUpsertPosition).toHaveBeenCalledWith('t1', 'p1', 'AAPL', 50, 150, 175);
      done();
    });
  });
});
