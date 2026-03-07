jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
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
