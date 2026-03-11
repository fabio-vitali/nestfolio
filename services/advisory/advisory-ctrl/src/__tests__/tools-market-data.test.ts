jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  StaticMarketDataProvider: jest.fn().mockImplementation(() => ({})),
  CachedMarketDataProvider: jest.fn().mockImplementation(() => ({
    getIndices: jest.fn().mockResolvedValue([
      { name: 'S&P 500', ticker: 'SPX', value: 5200, change: 0.003 },
      { name: 'NASDAQ', ticker: 'NDX', value: 18500, change: 0.005 },
      { name: 'Russell 2000', ticker: 'RUT', value: 2100, change: -0.001 },
      { name: 'Dow Jones', ticker: 'DJI', value: 39200, change: 0.002 },
    ]),
    getRates: jest.fn().mockResolvedValue([
      { rateType: 'fed', value: 4.25, asOf: '2026-03-01' },
      { rateType: 'treasury10Y', value: 4.10, asOf: '2026-03-01' },
      { rateType: 'treasury2Y', value: 3.95, asOf: '2026-03-01' },
      { rateType: 'treasury30Y', value: 4.30, asOf: '2026-03-01' },
    ]),
  })),
}));

import { handler } from '../handlers/tools/market-data';

describe('market-data tool handler', () => {
  it('should return market data structure with indices, volatility, and rates', async () => {
    const result = await handler({});

    expect(result).toEqual(
      expect.objectContaining({
        majorIndices: expect.arrayContaining([
          expect.objectContaining({ name: 'S&P 500', ticker: 'SPX' }),
          expect.objectContaining({ name: 'NASDAQ', ticker: 'NDX' }),
          expect.objectContaining({ name: 'Russell 2000', ticker: 'RUT' }),
        ]),
        volatilityIndex: expect.any(Number),
        interestRates: expect.objectContaining({
          fed: expect.any(Number),
          treasury10Y: expect.any(Number),
          treasury2Y: expect.any(Number),
        }),
        recentEvents: [],
        dataTimestamp: expect.any(String),
      }),
    );
  });

  it('should return a valid ISO timestamp', async () => {
    const result = (await handler({})) as { dataTimestamp: string };

    expect(new Date(result.dataTimestamp).toISOString()).toBe(result.dataTimestamp);
  });
});
