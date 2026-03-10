import { ShadowFillService, type ProposedTrade } from '../services/shadow-fill.service';

describe('ShadowFillService', () => {
  const service = new ShadowFillService();

  it('should return static price for known ETF symbol', () => {
    const trade: ProposedTrade = { symbol: 'VTI', side: 'BUY', quantity: 10 };
    const result = service.simulateFill(trade);

    expect(result.price).toBe(250.50);
    expect(result.totalValue).toBe(2505.0);
  });

  it('should return fallback price of 100 for unknown symbol', () => {
    const trade: ProposedTrade = { symbol: 'UNKNOWN', side: 'BUY', quantity: 5 };
    const result = service.simulateFill(trade);

    expect(result.price).toBe(100.0);
    expect(result.totalValue).toBe(500.0);
  });

  it('should compute totalValue as quantity * price', () => {
    const trade: ProposedTrade = { symbol: 'SPY', side: 'SELL', quantity: 3 };
    const result = service.simulateFill(trade);

    expect(result.price).toBe(520.15);
    expect(result.totalValue).toBeCloseTo(1560.45, 2);
  });

  it('should return price via getPrice for known symbol', () => {
    expect(service.getPrice('QQQ')).toBe(445.60);
    expect(service.getPrice('MISSING')).toBe(100.0);
  });
});
