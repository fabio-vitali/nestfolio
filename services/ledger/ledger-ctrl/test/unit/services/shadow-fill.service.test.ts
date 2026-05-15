import { ShadowFillService, type ProposedTrade } from '../../../src/services/shadow-fill.service';

describe('ShadowFillService', () => {
  const service = new ShadowFillService();

  it('reads quantityOrAmountCents and returns derivedQuantity = amount / fillPrice', async () => {
    // Unknown symbol exercises the fallback price of 100.0 — keeps the test
    // independent of changes to StaticMarketDataProvider quotes.
    const trade: ProposedTrade = {
      symbol: 'TEST-FAKE-SYM',
      side: 'BUY',
      quantityOrAmountCents: 500_000,
    };
    const result = await service.simulateFill(trade);
    expect(result.price).toBe(100.0);
    expect(result.derivedQuantity).toBe(50);
    expect(result.totalValue).toBeCloseTo(5_000, 5);
  });

  it('handles fractional shares without losing the source amount', async () => {
    const trade: ProposedTrade = { symbol: 'UNKNOWN', side: 'BUY', quantityOrAmountCents: 333_333 };
    const result = await service.simulateFill(trade);
    expect(result.price).toBe(100.0);
    expect(result.derivedQuantity).toBeCloseTo(33.3333, 4);
  });
});
