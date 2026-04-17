import { project } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { positionSnapshot } from '../../../src/transforms/position-snapshot';

type TestUow = UnitOfWork<BusEvent<Record<string, unknown>>>;

describe('positionSnapshot transform', () => {
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

  it('should return project intent for a position with symbol', () => {
    const result = positionSnapshot(makeUow({
      orderId: 'o1',
      symbol: 'VTI',
      filledQuantity: 10,
      averageFillPrice: 250,
    }));

    expect(result).toEqual(
      project('PositionSnapshot', {
        tenantId: 't1',
        symbol: 'VTI',
        assetClass: undefined,
        quantity: 10,
        avgCostBasisCents: 25_000,
        currentPriceCents: 25_000,
        marketValueCents: 250_000,
        weightPercent: 0,
        unrealizedPnlCents: 0,
      }, { pk: 'T#t1', sk: 'PositionSnapshot#VTI' }),
    );
  });

  it('should return undefined when no symbol or instrument', () => {
    expect(positionSnapshot(makeUow({
      orderId: 'o1',
      filledQuantity: 10,
      averageFillPrice: 250,
    }))).toBeUndefined();
  });

  it('should use instrument as fallback for symbol', () => {
    const result = positionSnapshot(makeUow({
      orderId: 'o1',
      instrument: 'BND',
      filledQuantity: 5,
      averageFillPrice: 80,
    }));

    expect(result).toEqual(
      project('PositionSnapshot', expect.objectContaining({
        symbol: 'BND',
      }), { pk: 'T#t1', sk: 'PositionSnapshot#BND' }),
    );
  });
});
