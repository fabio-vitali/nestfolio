import { getMarketData } from '../../../src/agents/tools/market-data';

describe('market-data tool', () => {
  it('returns market indices for default tickers', () => {
    const result = getMarketData();
    expect(result.indices).toHaveLength(4);
    expect(result.indices[0]).toHaveProperty('ticker');
    expect(result.indices[0]).toHaveProperty('price');
    expect(result.indices[0]).toHaveProperty('change');
    expect(result.indices[0]).toHaveProperty('volume');
    expect(result.volatility).toHaveProperty('vix');
    expect(result.timestamp).toBeDefined();
  });

  it('returns market indices for specified tickers', () => {
    const result = getMarketData({ tickers: ['SPY', 'QQQ'] });
    expect(result.indices).toHaveLength(2);
    expect(result.indices.map((i) => i.ticker)).toEqual(['SPY', 'QQQ']);
  });
});
