import { portfolioSummary } from '../../../src/transforms/portfolio-summary';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { z } from 'zod';

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

  it('throws ZodError on a bare snapshot (no `snapshot` wrapper) — enforces envelope contract', () => {
    expect(() => portfolioSummary(makeUow('BALANCE_UPDATED', { ...snapshot }))).toThrow(z.ZodError);
  });

  it('no-ops (returns undefined) for RECONCILIATION_COMPLETED — different event, no snapshot', () => {
    expect(portfolioSummary(makeUow('RECONCILIATION_COMPLETED', { foo: 'bar' }))).toBeUndefined();
  });

  it('throws ZodError on a snapshot-owned event (BALANCE_UPDATED) missing the snapshot key', () => {
    expect(() => portfolioSummary(makeUow('BALANCE_UPDATED', { foo: 'bar' }))).toThrow(z.ZodError);
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

  it('throws ZodError when lastEventSequence is absent in the snapshot', () => {
    const noVersion = { cashBalanceCents: 5000, positions: {} };
    expect(() => portfolioSummary(makeUow('BALANCE_UPDATED', { snapshot: noVersion }))).toThrow(z.ZodError);
  });

  it('throws ZodError when the snapshot violates the ledger contract', () => {
    const uow = {
      event: {
        id: 'e1', type: 'BALANCE_UPDATED', timestamp: 't',
        subject: { snapshot: { positions: {}, cashBalanceCents: 'NaN', lastEventSequence: 1 } },
        context: { tenantId: 't', userId: 'u', region: 'us-east-1' },
      },
      payload: {}, record: {},
    };
    expect(() => portfolioSummary(uow as never)).toThrow(z.ZodError);
  });
});
