import { positionSnapshot } from '../../../src/transforms/position-snapshot';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type TestUow = UnitOfWork<BusEvent<Record<string, unknown>>>;

const makeUow = (subject: Record<string, unknown>): TestUow => ({
  event: {
    id: 'e1',
    type: 'PORTFOLIO_UPDATED',
    timestamp: '2026-01-01T00:00:00.000Z',
    subject,
    context: { tenantId: 't1', userId: 'u1', region: 'us-east-1' },
  },
  payload: {},
  record: {},
}) as unknown as TestUow;

// AAPL: 10 @ $150 → 150000c market (75%); MSFT: 5 @ $100 → 50000c market (25%).
const snapshot = {
  lastEventSequence: 9,
  positions: {
    AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 100, totalCostBasis: 1000, lastFillPrice: 150 },
    MSFT: { symbol: 'MSFT', quantity: 5, averageCostBasis: 200, totalCostBasis: 1000, lastFillPrice: 100 },
  },
};

describe('positionSnapshot transform', () => {
  it('emits one versioned PositionSnapshot intent per holding with computed cents + weight', () => {
    const intents = positionSnapshot(makeUow({ snapshot }));
    expect(intents).toHaveLength(2);

    const aapl = intents.find((i) => (i as { overrides?: { sk?: string } }).overrides?.sk === 'PositionSnapshot#AAPL');
    expect(aapl).toEqual({
      _tag: 'projectVersioned',
      typename: 'PositionSnapshot',
      fields: {
        tenantId: 't1',
        userId: 'u1',
        region: 'us-east-1',
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        quantity: 10,
        avgCostBasisCents: 10000,   // 100 * 100
        currentPriceCents: 15000,   // 150 * 100
        marketValueCents: 150000,   // 10 * 150 * 100
        weightPercent: 75,          // 150000 / 200000 * 100
        unrealizedPnlCents: 50000,  // 150000 - (1000 * 100)
      },
      version: 9,
      overrides: { pk: 'T#t1', sk: 'PositionSnapshot#AAPL' },
    });

    const msft = intents.find((i) => (i as { overrides?: { sk?: string } }).overrides?.sk === 'PositionSnapshot#MSFT');
    expect(msft).toMatchObject({
      fields: { marketValueCents: 50000, weightPercent: 25, unrealizedPnlCents: -50000 },
      version: 9,
    });
  });

  it('returns an empty array when the snapshot has no positions', () => {
    expect(positionSnapshot(makeUow({ snapshot: { positions: {}, lastEventSequence: 1 } }))).toEqual([]);
  });

  it('drops (returns empty array) when lastEventSequence is absent', () => {
    expect(positionSnapshot(makeUow({ snapshot: {
      positions: { AAPL: { symbol: 'AAPL', quantity: 1, averageCostBasis: 1, totalCostBasis: 1, lastFillPrice: 1 } },
    } }))).toEqual([]);
  });
});
