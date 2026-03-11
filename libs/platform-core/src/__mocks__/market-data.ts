export function createMarketDataMocks() {
  const defaultQuote = { symbol: 'VTI', price: 250.50, change: 0, changePercent: 0, volume: 1000, timestamp: '2026-01-01' };
  return {
    StaticMarketDataProvider: jest.fn().mockImplementation(() => ({
      getQuote: jest.fn().mockResolvedValue(defaultQuote),
      getIndices: jest.fn().mockResolvedValue([]),
      getRates: jest.fn().mockResolvedValue([]),
    })),
    CachedMarketDataProvider: jest.fn().mockImplementation((_delegate: unknown) => ({
      getQuote: jest.fn().mockResolvedValue(defaultQuote),
      getIndices: jest.fn().mockResolvedValue([]),
      getRates: jest.fn().mockResolvedValue([]),
    })),
    KNOWN_SYMBOLS: [
      'VTI', 'VXUS', 'BND', 'VNQ', 'GLD', 'SPY', 'QQQ', 'IWM', 'EFA', 'EEM',
      'TLT', 'AGG', 'VIG', 'SCHD', 'VOO', 'VGSH', 'VCIT', 'VWO', 'IEMG', 'XLF',
      'BNDX', 'VTIP',
    ],
  };
}
