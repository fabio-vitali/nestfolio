import { response } from '../../../src/graphql/js-function/get-position-snapshots.fn.js';

describe('get-position-snapshots resolver', () => {
  it('filters out zero-quantity ghost holdings', () => {
    const ctx = { result: { items: [
      { symbol: 'AAPL', quantity: 10 },
      { symbol: 'TSLA', quantity: 0 },
    ] } };
    expect(response(ctx)).toEqual([{ symbol: 'AAPL', quantity: 10 }]);
  });

  it('returns [] when there are no items', () => {
    expect(response({ result: {} })).toEqual([]);
  });
});
