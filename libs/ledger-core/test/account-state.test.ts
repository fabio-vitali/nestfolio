import { INITIAL_ACCOUNT_STATE } from '../src/account-state';

describe('INITIAL_ACCOUNT_STATE', () => {
  it('should have $100k starting balance in cents', () => {
    expect(INITIAL_ACCOUNT_STATE.cashBalanceCents).toBe(10_000_000);
  });

  it('should have empty positions', () => {
    expect(INITIAL_ACCOUNT_STATE.positions).toEqual({});
  });

  it('should start at sequence 0', () => {
    expect(INITIAL_ACCOUNT_STATE.lastEventSequence).toBe(0);
  });
});
