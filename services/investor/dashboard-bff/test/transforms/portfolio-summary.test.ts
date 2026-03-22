import { accumulate, project } from '@nestfolio/event-processor';
import { portfolioSummary } from '../../src/transforms/portfolio-summary';

describe('portfolioSummary transform', () => {
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

  it('should return accumulate intent when filledQuantity and averageFillPrice exist', () => {
    expect(portfolioSummary(makeUow({
      filledQuantity: 10,
      averageFillPrice: 250,
    }) as any)).toEqual(
      accumulate('PortfolioSummary', {
        field: 'totalValueCents',
        increment: 250_000,
        overrides: { pk: 'T#t1', sk: 'PortfolioSummary' },
      }),
    );
  });

  it('should return project intent when only driftPercent exists', () => {
    expect(portfolioSummary(makeUow({
      driftPercent: 3.5,
    }) as any)).toEqual(
      project('PortfolioSummary', {
        tenantId: 't1',
        driftPercent: 3.5,
      }, { pk: 'T#t1', sk: 'PortfolioSummary' }),
    );
  });

  it('should return undefined when no relevant fields', () => {
    expect(portfolioSummary(makeUow({}) as any)).toBeUndefined();
  });
});
