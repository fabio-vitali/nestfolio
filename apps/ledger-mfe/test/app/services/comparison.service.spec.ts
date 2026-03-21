import { TestBed } from '@angular/core/testing';
import { GraphqlService } from '@nestfolio/shell/graphql';
import { ComparisonService } from '../../../src/app/services/comparison.service';

describe('ComparisonService', () => {
  let service: ComparisonService;
  let graphql: jest.Mocked<GraphqlService>;

  beforeEach(() => {
    graphql = { query: jest.fn(), mutate: jest.fn(), subscribe: jest.fn(), resetClient: jest.fn() } as any;
    TestBed.configureTestingModule({
      providers: [
        ComparisonService,
        { provide: GraphqlService, useValue: graphql },
      ],
    });
    service = TestBed.inject(ComparisonService);
  });

  it('should return simulation comparison data', async () => {
    const mockComparison = {
      actual: { totalValueCents: 10500000, cashBalanceCents: 200000, positionCount: 3, totalReturnPercent: 5.0, totalReturnCents: 500000 },
      simulated: { totalValueCents: 10800000, cashBalanceCents: 150000, positionCount: 4, totalReturnPercent: 8.0, totalReturnCents: 800000 },
      divergence: {
        returnDifferencePercent: 3.0,
        returnDifferenceCents: 300000,
        positionDifferences: [
          { symbol: 'AAPL', actualQuantity: 10, simulatedQuantity: 15, quantityDifference: 5, actualValueCents: 175000, simulatedValueCents: 262500 },
        ],
        missedDecisions: 1,
        totalDecisions: 5,
      },
    };
    graphql.query.mockResolvedValue({ getSimulationComparison: mockComparison });

    const result = await service.getSimulationComparison();

    expect(graphql.query).toHaveBeenCalledWith(expect.any(String));
    expect(result).toEqual(mockComparison);
    expect(result.divergence.positionDifferences).toHaveLength(1);
  });
});
