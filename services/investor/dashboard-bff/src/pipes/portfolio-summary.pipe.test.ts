jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
  IdempotencyGuard: jest.fn(),
}));

import Highland from 'highland';
import { type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { PortfolioSummaryPipe } from './portfolio-summary.pipe';

describe('PortfolioSummaryPipe', () => {
  const mockGetPortfolioSummary = jest.fn();
  const mockUpsertPortfolioSummary = jest.fn().mockResolvedValue({});

  const mockRepository = {
    getPortfolioSummary: mockGetPortfolioSummary,
    upsertPortfolioSummary: mockUpsertPortfolioSummary,
  } as any;

  let pipe: PortfolioSummaryPipe;

  beforeEach(() => {
    jest.clearAllMocks();
    pipe = new PortfolioSummaryPipe(mockRepository);
  });

  it('should initialize totalValueCents from first trade when no existing summary', (done) => {
    mockGetPortfolioSummary.mockResolvedValue(null);

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

    const source = Highland<UnitOfWork<BusEvent<any>>>([uow]);

    pipe.feed(source).done(() => {
      expect(mockGetPortfolioSummary).toHaveBeenCalledWith('t1');
      // 100 * 150 * 100 = 1_500_000 cents, no existing summary so starts from 0
      expect(mockUpsertPortfolioSummary).toHaveBeenCalledWith('t1', {
        totalValueCents: 1_500_000,
      });
      done();
    });
  });

  it('should accumulate totalValueCents across subsequent trades', (done) => {
    mockGetPortfolioSummary.mockResolvedValue({ totalValueCents: 1_500_000 });

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

    const source = Highland<UnitOfWork<BusEvent<any>>>([uow]);

    pipe.feed(source).done(() => {
      expect(mockGetPortfolioSummary).toHaveBeenCalledWith('t1');
      // Existing 1_500_000 + new 50 * 200 * 100 = 1_500_000 + 1_000_000 = 2_500_000
      expect(mockUpsertPortfolioSummary).toHaveBeenCalledWith('t1', {
        totalValueCents: 2_500_000,
      });
      done();
    });
  });
});
