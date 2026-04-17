import { handler } from '../../../src/handlers/tools/market-data.handler';

describe('market-data tool handler', () => {
  it('should return market indices for default tickers', async () => {
    const result = await handler({});
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.indices).toHaveLength(4);
    expect(body.indices[0]).toHaveProperty('ticker');
    expect(body.indices[0]).toHaveProperty('price');
    expect(body.indices[0]).toHaveProperty('change');
    expect(body.indices[0]).toHaveProperty('volume');
    expect(body.volatility).toHaveProperty('vix');
    expect(body.timestamp).toBeDefined();
  });

  it('should return market indices for specified tickers', async () => {
    const result = await handler({ tickers: ['SPY', 'QQQ'] });
    const body = JSON.parse(result.body);

    expect(body.indices).toHaveLength(2);
    expect(body.indices.map((i: Record<string, unknown>) => i.ticker)).toEqual(['SPY', 'QQQ']);
  });
});
