jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
  IdempotencyGuard: jest.fn(),
}));

import { type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { PositionSnapshotPipe } from './position-snapshot.pipe';

describe('PositionSnapshotPipe', () => {
  const mockUpsertPositionSnapshot = jest.fn().mockResolvedValue({});

  const mockRepository = {
    upsertPositionSnapshot: mockUpsertPositionSnapshot,
  } as any;

  let pipe: PositionSnapshotPipe;

  beforeEach(() => {
    jest.clearAllMocks();
    pipe = new PositionSnapshotPipe(mockRepository);
  });

  it('should upsert position snapshot from ORDER_FILLED event with symbol', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-1',
        type: 'ORDER_FILLED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          orderId: 'o1',
          symbol: 'AAPL',
          filledQuantity: 10,
          averageFillPrice: 150.0,
          assetClass: 'EQUITY',
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockUpsertPositionSnapshot).toHaveBeenCalledWith('t1', {
      symbol: 'AAPL',
      assetClass: 'EQUITY',
      quantity: 10,
      avgCostBasisCents: 15000, // 150 * 100
      currentPriceCents: 15000, // falls back to avgCost when no currentPrice
      marketValueCents: 150000, // 10 * 15000
      weightPercent: 0,
      unrealizedPnlCents: 0, // marketValue - qty * avgCost = 0
    });
  });

  it('should fall back to instrument when symbol is missing', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-2',
        type: 'ORDER_FILLED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          orderId: 'o2',
          instrument: 'MSFT',
          filledQuantity: 5,
          averageFillPrice: 300.0,
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockUpsertPositionSnapshot).toHaveBeenCalledWith('t1',
      expect.objectContaining({ symbol: 'MSFT' }),
    );
  });

  it('should skip when neither symbol nor instrument is present', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-3',
        type: 'ORDER_FILLED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          orderId: 'o3',
          filledQuantity: 5,
          averageFillPrice: 100.0,
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockUpsertPositionSnapshot).not.toHaveBeenCalled();
  });

  it('should use explicit currentPrice and marketValue when provided', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-4',
        type: 'ORDER_FILLED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {
          orderId: 'o4',
          symbol: 'GOOG',
          filledQuantity: 20,
          averageFillPrice: 100.0,
          avgCostBasis: 95.0,
          currentPrice: 110.0,
          marketValue: 2200.0,
          weightPercent: 25.5,
          unrealizedPnl: 300.0,
          assetClass: 'EQUITY',
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockUpsertPositionSnapshot).toHaveBeenCalledWith('t1', {
      symbol: 'GOOG',
      assetClass: 'EQUITY',
      quantity: 20,
      avgCostBasisCents: 9500, // avgCostBasis 95 * 100
      currentPriceCents: 11000, // currentPrice 110 * 100
      marketValueCents: 220000, // marketValue 2200 * 100
      weightPercent: 25.5,
      unrealizedPnlCents: 30000, // unrealizedPnl 300 * 100
    });
  });
});
