import { accumulate, project } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { portfolioSummary } from '../../../src/transforms/portfolio-summary';

type TestUow = UnitOfWork<BusEvent<Record<string, unknown>>>;

describe('portfolioSummary transform', () => {
  const makeUow = (subject: Record<string, unknown>): TestUow => ({
    event: {
      id: 'e1',
      type: 'PORTFOLIO_UPDATED',
      timestamp: '2026-01-01T00:00:00.000Z',
      subject,
      context: { tenantId: 't1' },
    },
    payload: {},
    record: {},
  }) as unknown as TestUow;

  it('should return accumulate intent when filledQuantity and averageFillPrice exist', () => {
    expect(portfolioSummary(makeUow({
      filledQuantity: 10,
      averageFillPrice: 250,
    }))).toEqual(
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
    }))).toEqual(
      project('PortfolioSummary', {
        tenantId: 't1',
        driftPercent: 3.5,
      }, { pk: 'T#t1', sk: 'PortfolioSummary' }),
    );
  });

  it('should return undefined when no relevant fields', () => {
    expect(portfolioSummary(makeUow({}))).toBeUndefined();
  });
});
