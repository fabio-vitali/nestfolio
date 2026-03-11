import { TestBed } from '@angular/core/testing';
import { GraphqlService } from '@nestfolio/appsync-client';
import { TimeTravelService } from '../../../src/app/services/time-travel.service';

describe('TimeTravelService', () => {
  let service: TimeTravelService;
  let graphql: jest.Mocked<GraphqlService>;

  beforeEach(() => {
    graphql = {
      query: jest.fn(),
      mutate: jest.fn(),
      subscribe: jest.fn(),
      resetClient: jest.fn(),
    } as jest.Mocked<GraphqlService>;
    TestBed.configureTestingModule({
      providers: [
        { provide: GraphqlService, useValue: graphql },
      ],
    });
    service = TestBed.inject(TimeTravelService);
  });

  it('should fetch availability', async () => {
    graphql.query.mockResolvedValueOnce({
      getTimeTravelAvailability: {
        available: true,
        oldestDate: '2025-01-01',
        latestDate: '2025-06-15',
      },
    });

    const result = await service.getAvailability();

    expect(result.available).toBe(true);
    expect(result.oldestDate).toBe('2025-01-01');
    expect(result.latestDate).toBe('2025-06-15');
    expect(graphql.query).toHaveBeenCalledWith(expect.any(String));
  });

  it('should fetch portfolio at timestamp', async () => {
    const portfolio = {
      positions: [{ symbol: 'VTI', quantity: 10, averageCostBasis: 250, totalCostBasis: 2500, lastFillPrice: 255 }],
      cashBalanceCents: 7_500_000,
      totalValueCents: 10_000_000,
      positionCount: 1,
      snapshotAt: '2025-06-15T23:59:59.000Z',
      streamType: 'ACTUAL',
    };

    graphql.query.mockResolvedValueOnce({ getPortfolioAt: portfolio });

    const result = await service.getPortfolioAt('ACTUAL', '2025-06-15T23:59:59.000Z');

    expect(result).toEqual(portfolio);
    expect(graphql.query).toHaveBeenCalledWith(expect.any(String), {
      streamType: 'ACTUAL',
      timestamp: '2025-06-15T23:59:59.000Z',
    });
  });

});
