import { response } from '../../../src/graphql/js-function/get-positions.fn.js';

describe('get-positions resolver', () => {
  it('filters zero-quantity rows from the all-positions list', () => {
    const ctx = { arguments: {}, result: { items: [
      { symbol: 'AAPL', quantity: 10, averageCostBasis: 1, totalCostBasis: 1, lastFillPrice: 2 },
      { symbol: 'TSLA', quantity: 0, averageCostBasis: 0, totalCostBasis: 0, lastFillPrice: 5 },
    ] } };
    const out = response(ctx) as Array<{ symbol: string }>;
    expect(out.map((p) => p.symbol)).toEqual(['AAPL']);
  });

  it('returns the single-symbol lookup as-is even at quantity 0', () => {
    const ctx = { arguments: { symbol: 'TSLA' }, result: { symbol: 'TSLA', quantity: 0 } };
    expect(response(ctx)).toEqual([{
      symbol: 'TSLA', quantity: 0, averageCostBasis: 0, totalCostBasis: 0, lastFillPrice: 0,
    }]);
  });
});
