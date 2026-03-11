import { StaticMarketDataProvider } from './market-data-client';
import { CachedMarketDataProvider } from './cached-market-data';
import type { MarketDataProvider } from './market-data-client';

describe('StaticMarketDataProvider', () => {
  const provider = new StaticMarketDataProvider();

  it('should return quote for known symbol', async () => {
    const quote = await provider.getQuote('VTI');
    expect(quote).not.toBeNull();
    expect(quote!.symbol).toBe('VTI');
    expect(quote!.price).toBe(250.50);
    expect(quote!.change).toBe(1.25);
    expect(quote!.changePercent).toBe(0.50);
    expect(quote!.volume).toBe(5_200_000);
    expect(quote!.timestamp).toBeDefined();
  });

  it('should return null for unknown symbol', async () => {
    const quote = await provider.getQuote('UNKNOWN');
    expect(quote).toBeNull();
  });

  it('should return indices', async () => {
    const indices = await provider.getIndices();
    expect(indices.length).toBeGreaterThan(0);
    expect(indices[0]).toHaveProperty('name');
    expect(indices[0]).toHaveProperty('ticker');
    expect(indices[0]).toHaveProperty('value');
    expect(indices[0]).toHaveProperty('change');
  });

  it('should return rates', async () => {
    const rates = await provider.getRates();
    expect(rates.length).toBeGreaterThan(0);
    expect(rates[0]).toHaveProperty('rateType');
    expect(rates[0]).toHaveProperty('value');
    expect(rates[0]).toHaveProperty('asOf');
  });

  it('should return defensive copies of indices', async () => {
    const indices1 = await provider.getIndices();
    const indices2 = await provider.getIndices();
    expect(indices1).not.toBe(indices2);
    expect(indices1).toEqual(indices2);
  });

  it('should return defensive copies of rates', async () => {
    const rates1 = await provider.getRates();
    const rates2 = await provider.getRates();
    expect(rates1).not.toBe(rates2);
    expect(rates1).toEqual(rates2);
  });

  it('should include all 20+ ETF symbols', async () => {
    const symbols = ['VTI', 'VXUS', 'BND', 'VNQ', 'GLD', 'SPY', 'QQQ', 'IWM', 'EFA', 'EEM',
      'TLT', 'AGG', 'VIG', 'SCHD', 'VOO', 'VGSH', 'VCIT', 'VWO', 'IEMG', 'XLF'];
    for (const symbol of symbols) {
      const quote = await provider.getQuote(symbol);
      expect(quote).not.toBeNull();
      expect(quote!.price).toBeGreaterThan(0);
    }
  });
});

describe('CachedMarketDataProvider', () => {
  it('should cache quotes within TTL', async () => {
    const mockProvider: MarketDataProvider = {
      getQuote: jest.fn().mockResolvedValue({
        symbol: 'VTI', price: 250.5, change: 1.2, changePercent: 0.48, volume: 5000000, timestamp: '2026-01-01',
      }),
      getIndices: jest.fn().mockResolvedValue([]),
      getRates: jest.fn().mockResolvedValue([]),
    };
    const cached = new CachedMarketDataProvider(mockProvider, 60_000);

    await cached.getQuote('VTI');
    await cached.getQuote('VTI');

    expect(mockProvider.getQuote).toHaveBeenCalledTimes(1);
  });

  it('should return null for unknown symbol from cache', async () => {
    const mockProvider: MarketDataProvider = {
      getQuote: jest.fn().mockResolvedValue(null),
      getIndices: jest.fn().mockResolvedValue([]),
      getRates: jest.fn().mockResolvedValue([]),
    };
    const cached = new CachedMarketDataProvider(mockProvider, 60_000);

    const result = await cached.getQuote('UNKNOWN');
    expect(result).toBeNull();

    // Second call should use cache (null is a valid cached value)
    await cached.getQuote('UNKNOWN');
    expect(mockProvider.getQuote).toHaveBeenCalledTimes(1);
  });

  it('should cache indices', async () => {
    const mockProvider: MarketDataProvider = {
      getQuote: jest.fn().mockResolvedValue(null),
      getIndices: jest.fn().mockResolvedValue([{ name: 'S&P 500', ticker: 'SPX', value: 5200, change: 0.003 }]),
      getRates: jest.fn().mockResolvedValue([]),
    };
    const cached = new CachedMarketDataProvider(mockProvider, 60_000);

    await cached.getIndices();
    await cached.getIndices();

    expect(mockProvider.getIndices).toHaveBeenCalledTimes(1);
  });

  it('should cache rates', async () => {
    const mockProvider: MarketDataProvider = {
      getQuote: jest.fn().mockResolvedValue(null),
      getIndices: jest.fn().mockResolvedValue([]),
      getRates: jest.fn().mockResolvedValue([{ rateType: 'fed', value: 4.25, asOf: '2026-03-01' }]),
    };
    const cached = new CachedMarketDataProvider(mockProvider, 60_000);

    await cached.getRates();
    await cached.getRates();

    expect(mockProvider.getRates).toHaveBeenCalledTimes(1);
  });

  it('should re-fetch after TTL expires', async () => {
    const mockProvider: MarketDataProvider = {
      getQuote: jest.fn().mockResolvedValue({
        symbol: 'VTI', price: 250.5, change: 1.2, changePercent: 0.48, volume: 5000000, timestamp: '2026-01-01',
      }),
      getIndices: jest.fn().mockResolvedValue([]),
      getRates: jest.fn().mockResolvedValue([]),
    };
    const cached = new CachedMarketDataProvider(mockProvider, 1); // 1ms TTL

    await cached.getQuote('VTI');

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 10));

    await cached.getQuote('VTI');

    expect(mockProvider.getQuote).toHaveBeenCalledTimes(2);
  });
});
