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
import { SnapshotImportedPipe } from '../pipes/snapshot-imported.pipe';

describe('SnapshotImportedPipe', () => {
  const mockGetOrCreatePortfolio = jest.fn().mockResolvedValue({});
  const mockUpsertPosition = jest.fn().mockResolvedValue({});
  const mockUpdatePortfolio = jest.fn().mockResolvedValue({});
  const mockUpdateCashBalance = jest.fn().mockResolvedValue({});

  const mockRepository = {
    getOrCreatePortfolio: mockGetOrCreatePortfolio,
    upsertPosition: mockUpsertPosition,
    updatePortfolio: mockUpdatePortfolio,
    updateCashBalance: mockUpdateCashBalance,
  } as any;

  let pipe: SnapshotImportedPipe;

  beforeEach(() => {
    jest.clearAllMocks();
    pipe = new SnapshotImportedPipe(mockRepository);
  });

  it('should reconcile positions and cash balance on happy path', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-snap-1',
        type: 'SNAPSHOT_IMPORTED',
        timestamp: '2025-01-15T00:00:00.000Z',
        subject: {
          tenantId: 't1',
          portfolioId: 'p1',
          positions: [
            { symbol: 'AAPL', quantity: 100, averageCostBasis: 150, currentPrice: 175 },
            { symbol: 'MSFT', quantity: 50, averageCostBasis: 300, currentPrice: 320 },
          ],
          cashBalance: 5000,
          currency: 'EUR',
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockGetOrCreatePortfolio).toHaveBeenCalledWith('t1', 'p1');

    expect(mockUpsertPosition).toHaveBeenCalledTimes(2);
    expect(mockUpsertPosition).toHaveBeenCalledWith('t1', 'p1', 'AAPL', 100, 150, 175);
    expect(mockUpsertPosition).toHaveBeenCalledWith('t1', 'p1', 'MSFT', 50, 300, 320);

    expect(mockUpdateCashBalance).toHaveBeenCalledWith('t1', 'p1', 'EUR', 5000);

    // totalValue = 100*175 + 50*320 + 5000 = 17500 + 16000 + 5000 = 38500
    expect(mockUpdatePortfolio).toHaveBeenCalledWith('t1', 'p1', {
      totalValue: 38500,
      positionCount: 2,
      cashBalance: 5000,
    });
  });

  it('should handle empty positions array', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-snap-2',
        type: 'SNAPSHOT_IMPORTED',
        timestamp: '2025-01-15T00:00:00.000Z',
        subject: {
          tenantId: 't1',
          portfolioId: 'p1',
          positions: [],
          cashBalance: 1000,
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockGetOrCreatePortfolio).toHaveBeenCalledWith('t1', 'p1');
    expect(mockUpsertPosition).not.toHaveBeenCalled();
    expect(mockUpdateCashBalance).toHaveBeenCalledWith('t1', 'p1', 'USD', 1000);

    // totalValue = 0 (no positions) + 1000 (cash) = 1000
    expect(mockUpdatePortfolio).toHaveBeenCalledWith('t1', 'p1', {
      totalValue: 1000,
      positionCount: 0,
      cashBalance: 1000,
    });
  });

  it('should skip cash balance update when no cash in payload', async () => {
    const uow: UnitOfWork<BusEvent<any>> = {
      event: {
        id: 'evt-snap-3',
        type: 'SNAPSHOT_IMPORTED',
        timestamp: '2025-01-15T00:00:00.000Z',
        subject: {
          tenantId: 't1',
          portfolioId: 'p1',
          positions: [
            { symbol: 'GOOG', quantity: 10, averageCostBasis: 2500, currentPrice: 2700 },
          ],
        },
        context: { tenantId: 't1' },
      },
      payload: {},
      record: {},
    };

    await pipe.process(uow);

    expect(mockGetOrCreatePortfolio).toHaveBeenCalledWith('t1', 'p1');

    expect(mockUpsertPosition).toHaveBeenCalledTimes(1);
    expect(mockUpsertPosition).toHaveBeenCalledWith('t1', 'p1', 'GOOG', 10, 2500, 2700);

    expect(mockUpdateCashBalance).not.toHaveBeenCalled();

    // totalValue = 10*2700 = 27000, no cash
    expect(mockUpdatePortfolio).toHaveBeenCalledWith('t1', 'p1', {
      totalValue: 27000,
      positionCount: 1,
      cashBalance: 0,
    });
  });
});
