import { INITIAL_PORTFOLIO_STATE } from './portfolio-state';

describe('INITIAL_PORTFOLIO_STATE', () => {
  it('should have $100k starting balance in cents', () => {
    expect(INITIAL_PORTFOLIO_STATE.cashBalanceCents).toBe(10_000_000);
  });

  it('should have empty positions', () => {
    expect(INITIAL_PORTFOLIO_STATE.positions).toEqual({});
  });

  it('should start at sequence 0', () => {
    expect(INITIAL_PORTFOLIO_STATE.lastEventSequence).toBe(0);
  });
});
