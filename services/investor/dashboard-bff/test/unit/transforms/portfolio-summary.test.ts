import { portfolioSummary } from '../../../src/transforms/portfolio-summary';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type TestUow = UnitOfWork<BusEvent<Record<string, unknown>>>;

const makeUow = (type: string, subject: Record<string, unknown>): TestUow => ({
  event: {
    id: 'e1',
    type,
    timestamp: '2026-01-01T00:00:00.000Z',
    subject,
    context: { tenantId: 't1', userId: 'u1', region: 'us-east-1' },
  },
  payload: {},
  record: {},
}) as unknown as TestUow;

// AAPL: 10 @ $150 → 150000c market; MSFT: 5 @ $100 → 50000c market. Σ market = 200000c.
const snapshot = {
  cashBalanceCents: 5000,
  lastEventSequence: 7,
  positions: {
    AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 100, totalCostBasis: 1000, lastFillPrice: 150 },
    MSFT: { symbol: 'MSFT', quantity: 5, averageCostBasis: 200, totalCostBasis: 1000, lastFillPrice: 100 },
  },
};

describe('portfolioSummary transform', () => {
  it('projects a versioned full PortfolioSummary row from a ledger snapshot', () => {
    expect(portfolioSummary(makeUow('PORTFOLIO_UPDATED', { snapshot }))).toEqual({
      _tag: 'projectVersioned',
      typename: 'PortfolioSummary',
      fields: {
        tenantId: 't1',
        userId: 'u1',
        region: 'us-east-1',
        cashBalanceCents: 5000,
        positionCount: 2,
        totalValueCents: 205000, // 5000 cash + 150000 + 50000 market
      },
      version: 7,
      overrides: { pk: 'T#t1', sk: 'PortfolioSummary' },
    });
  });

  it('accepts a bare snapshot payload (no `snapshot` wrapper)', () => {
    expect(portfolioSummary(makeUow('BALANCE_UPDATED', { ...snapshot }))).toMatchObject({
      _tag: 'projectVersioned',
      version: 7,
      fields: { cashBalanceCents: 5000, positionCount: 2, totalValueCents: 205000 },
    });
  });

  it('returns undefined when no snapshot/cashBalance is present', () => {
    expect(portfolioSummary(makeUow('RECONCILIATION_COMPLETED', { foo: 'bar' }))).toBeUndefined();
  });

  it('excludes zero-quantity (fully-exited) positions from positionCount', () => {
    const withGhost = {
      cashBalanceCents: 5000,
      lastEventSequence: 8,
      positions: {
        AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 100, totalCostBasis: 1000, lastFillPrice: 150 },
        TSLA: { symbol: 'TSLA', quantity: 0, averageCostBasis: 0, totalCostBasis: 0, lastFillPrice: 200 },
      },
    };
    expect(portfolioSummary(makeUow('PORTFOLIO_UPDATED', { snapshot: withGhost }))).toMatchObject({
      fields: { positionCount: 1, totalValueCents: 155000 }, // only AAPL; TSLA contributes 0
      version: 8,
    });
  });

  it('drops (returns undefined) when lastEventSequence is absent', () => {
    const noVersion = { cashBalanceCents: 5000, positions: {} };
    expect(portfolioSummary(makeUow('PORTFOLIO_UPDATED', { snapshot: noVersion }))).toBeUndefined();
  });
});
