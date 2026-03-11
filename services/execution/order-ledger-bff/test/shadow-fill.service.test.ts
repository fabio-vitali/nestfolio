jest.mock('@nestfolio/platform-core', () => ({
  StaticMarketDataProvider: jest.fn().mockImplementation(() => ({})),
  CachedMarketDataProvider: jest.fn().mockImplementation(() => ({
    getQuote: jest.fn().mockImplementation(async (symbol: string) => {
      const prices: Record<string, number> = {
        VTI: 250.50, SPY: 520.15, QQQ: 445.60, BND: 72.30,
      };
      const price = prices[symbol];
      if (!price) return null;
      return { symbol, price, change: 0, changePercent: 0, volume: 1000, timestamp: '2026-01-01' };
    }),
  })),
}));

import { ShadowFillService, type ProposedTrade } from '../src/services/shadow-fill.service';

describe('ShadowFillService', () => {
  const service = new ShadowFillService();

  it('should return static price for known ETF symbol', async () => {
    const trade: ProposedTrade = { symbol: 'VTI', side: 'BUY', quantity: 10 };
    const result = await service.simulateFill(trade);

    expect(result.price).toBe(250.50);
    expect(result.totalValue).toBe(2505.0);
  });

  it('should return fallback price of 100 for unknown symbol', async () => {
    const trade: ProposedTrade = { symbol: 'UNKNOWN', side: 'BUY', quantity: 5 };
    const result = await service.simulateFill(trade);

    expect(result.price).toBe(100.0);
    expect(result.totalValue).toBe(500.0);
  });

  it('should compute totalValue as quantity * price', async () => {
    const trade: ProposedTrade = { symbol: 'SPY', side: 'SELL', quantity: 3 };
    const result = await service.simulateFill(trade);

    expect(result.price).toBe(520.15);
    expect(result.totalValue).toBeCloseTo(1560.45, 2);
  });

  it('should return price via getPrice for known symbol', async () => {
    expect(await service.getPrice('QQQ')).toBe(445.60);
    expect(await service.getPrice('MISSING')).toBe(100.0);
  });
});
