jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

import { MarketDataService } from '../services/market-data.service';

describe('MarketDataService', () => {
  let service: MarketDataService;

  beforeEach(() => {
    service = new MarketDataService();
  });

  describe('getPrice', () => {
    it('should return price for known ETF symbols', () => {
      expect(service.getPrice('VTI')).toBe(250.50);
      expect(service.getPrice('SPY')).toBe(520.15);
      expect(service.getPrice('BND')).toBe(72.30);
      expect(service.getPrice('GLD')).toBe(195.80);
      expect(service.getPrice('VOO')).toBe(480.20);
    });

    it('should return null for unknown symbols', () => {
      expect(service.getPrice('AAPL')).toBeNull();
      expect(service.getPrice('UNKNOWN')).toBeNull();
      expect(service.getPrice('')).toBeNull();
    });

    it('should be case-sensitive', () => {
      expect(service.getPrice('vti')).toBeNull();
      expect(service.getPrice('Vti')).toBeNull();
    });
  });

  describe('getAllPrices', () => {
    it('should return a copy of all prices', () => {
      const prices = service.getAllPrices();

      expect(Object.keys(prices).length).toBe(20);
      expect(prices.VTI).toBe(250.50);
      expect(prices.XLF).toBe(42.90);
    });

    it('should return a new object each time (defensive copy)', () => {
      const prices1 = service.getAllPrices();
      const prices2 = service.getAllPrices();

      expect(prices1).not.toBe(prices2);
      expect(prices1).toEqual(prices2);
    });

    it('should not allow mutation of internal state', () => {
      const prices = service.getAllPrices();
      prices.VTI = 999;

      expect(service.getPrice('VTI')).toBe(250.50);
    });
  });
});
