import { project } from '@nestfolio/event-processor';
import { portfolioUpdated } from '../../src/transforms/portfolio-updated';

describe('portfolioUpdated transform', () => {
  const makeUow = (subject: Record<string, unknown>) => ({
    event: {
      id: 'e1',
      type: 'PORTFOLIO_UPDATED',
      timestamp: '2026-01-01T00:00:00.000Z',
      subject,
      context: { tenantId: 't1' },
    },
    payload: {},
    record: {},
  });

  it('should return project intents for each position', () => {
    const result = portfolioUpdated(makeUow({
      positions: {
        VTI: { symbol: 'VTI', quantity: 10, averageCostBasis: 250, totalCostBasis: 2500, lastFillPrice: 251 },
      },
    }) as Parameters<typeof portfolioUpdated>[0]);

    expect(result).toEqual(
      project('Position', {
        tenantId: 't1',
        symbol: 'VTI',
        quantity: 10,
        averageCostBasis: 250,
        totalCostBasis: 2500,
        lastFillPrice: 251,
      }, { pk: 'Portfolio#t1', sk: 'Position#VTI' }),
    );
  });

  it('should return array with snapshot when snapshot is present', () => {
    const result = portfolioUpdated(makeUow({
      positions: {
        VTI: { symbol: 'VTI', quantity: 10, averageCostBasis: 250, totalCostBasis: 2500, lastFillPrice: 251 },
      },
      snapshot: {
        positions: { VTI: { symbol: 'VTI', quantity: 10 } },
        cashBalanceCents: 9_500_000,
        lastEventSequence: 6,
      },
    }) as Parameters<typeof portfolioUpdated>[0]);

    expect(Array.isArray(result)).toBe(true);
    const intents = result as Record<string, unknown>[];
    expect(intents).toHaveLength(2);
    expect(intents[0].typename).toBe('Position');
    expect(intents[1].typename).toBe('SnapshotAt');
  });

  it('should return empty array for empty positions', () => {
    const result = portfolioUpdated(makeUow({ positions: {} }) as Parameters<typeof portfolioUpdated>[0]);
    // With empty positions and no snapshot, intents array is empty → length 1 check fails
    expect(result).toEqual([]);
  });
});
