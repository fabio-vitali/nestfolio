const mockGetQuote = jest.fn();

jest.mock('@nestfolio/event-processor', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  StaticMarketDataProvider: jest.fn().mockImplementation(() => ({})),
  CachedMarketDataProvider: jest.fn().mockImplementation(() => ({
    getQuote: mockGetQuote,
  })),
  KNOWN_SYMBOLS: [
    'VTI', 'VXUS', 'BND', 'VNQ', 'GLD', 'SPY', 'QQQ', 'IWM', 'EFA', 'EEM',
    'TLT', 'AGG', 'VIG', 'SCHD', 'VOO', 'VGSH', 'VCIT', 'VWO', 'IEMG', 'XLF',
  ],

  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),

}));
import { MarketDataService } from '../../src/services/market-data.service';

describe('MarketDataService', () => {
  let service: MarketDataService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MarketDataService();
  });

  describe('getPrice', () => {
    it('should return price for known ETF symbols', async () => {
      mockGetQuote.mockResolvedValue({ symbol: 'VTI', price: 250.50, change: 1.25, changePercent: 0.50, volume: 5200000, timestamp: '2026-01-01' });
      expect(await service.getPrice('VTI')).toBe(250.50);

      mockGetQuote.mockResolvedValue({ symbol: 'SPY', price: 520.15, change: 1.56, changePercent: 0.30, volume: 42000000, timestamp: '2026-01-01' });
      expect(await service.getPrice('SPY')).toBe(520.15);
    });

    it('should return null for unknown symbols', async () => {
      mockGetQuote.mockResolvedValue(null);
      expect(await service.getPrice('AAPL')).toBeNull();
      expect(await service.getPrice('UNKNOWN')).toBeNull();
    });
  });

  describe('getAllPrices', () => {
    it('should return prices for all known symbols', async () => {
      mockGetQuote.mockImplementation(async (symbol: string) => ({
        symbol,
        price: 100,
        change: 0,
        changePercent: 0,
        volume: 1000,
        timestamp: '2026-01-01',
      }));

      const prices = await service.getAllPrices();

      expect(Object.keys(prices).length).toBe(20);
      expect(prices.VTI).toBe(100);
      expect(prices.XLF).toBe(100);
    });

    it('should skip symbols that return null', async () => {
      mockGetQuote.mockImplementation(async (symbol: string) => {
        if (symbol === 'VTI') return { symbol, price: 250.50, change: 0, changePercent: 0, volume: 1000, timestamp: '2026-01-01' };
        return null;
      });

      const prices = await service.getAllPrices();

      expect(prices.VTI).toBe(250.50);
      expect(Object.keys(prices).length).toBe(1);
    });
  });
});
