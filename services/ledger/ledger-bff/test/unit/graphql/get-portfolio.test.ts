import { response } from '../../../src/graphql/js-function/get-portfolio.fn.js';

describe('get-portfolio resolver', () => {
  it('omits zero-quantity positions but keeps totals correct', () => {
    const ctx = { result: { items: [
      { sk: 'Latest', cashBalanceCents: 5000 },
      { sk: 'Position#AAPL', symbol: 'AAPL', quantity: 10, totalCostBasis: 10, lastFillPrice: 150 },
      { sk: 'Position#TSLA', symbol: 'TSLA', quantity: 0, totalCostBasis: 0, lastFillPrice: 200 },
    ] } };
    const out = response(ctx) as { positions: Array<{ symbol: string }>; totalValueCents: number };
    expect(out.positions.map((p) => p.symbol)).toEqual(['AAPL']);
    expect(out.totalValueCents).toBe(155000); // 5000 cash + 150000 AAPL; TSLA contributes 0
  });
});
