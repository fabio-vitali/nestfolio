import { MICRO_TRADE_EPSILON_BPS } from '../../src/trade-thresholds';

describe('trade-thresholds', () => {
  it('exports MICRO_TRADE_EPSILON_BPS as 100 (1% of portfolio value)', () => {
    expect(MICRO_TRADE_EPSILON_BPS).toBe(100);
  });
});
