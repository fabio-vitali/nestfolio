import { applyCommand } from '../../../src/command';
import { INITIAL_PORTFOLIO_STATE } from '../../../src/state/portfolio-state';
import { RecordWithdrawal } from '../../../src/commands/execution/record-withdrawal';

const validWithdrawal = {
  withdrawalId: 'wth-1',
  amountCents: 200_000, // $2,000
  withdrawnAt: '2026-01-15T10:00:00.000Z',
};

describe('RecordWithdrawal', () => {
  it('should have type RecordWithdrawal', () => {
    expect(RecordWithdrawal.type).toBe('RecordWithdrawal');
  });

  it('should decrease cash balance', () => {
    const result = applyCommand(RecordWithdrawal, validWithdrawal, INITIAL_PORTFOLIO_STATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextState.cashBalanceCents).toBe(10_000_000 - 200_000);
  });

  it('should not affect positions', () => {
    const result = applyCommand(RecordWithdrawal, validWithdrawal, INITIAL_PORTFOLIO_STATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextState.positions).toEqual({});
  });

  it('should return invariant error when withdrawing more than cash balance', () => {
    const overWithdraw = { ...validWithdrawal, amountCents: 20_000_000 };
    const result = applyCommand(RecordWithdrawal, overWithdraw, INITIAL_PORTFOLIO_STATE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('invariant');
      expect(result.error.message).toContain('Insufficient cash');
    }
  });

  it('should reject non-integer amount', () => {
    const result = applyCommand(
      RecordWithdrawal,
      { ...validWithdrawal, amountCents: 100.5 },
      INITIAL_PORTFOLIO_STATE,
    );
    expect(result.ok).toBe(false);
  });

  it('should reject negative amount', () => {
    const result = applyCommand(
      RecordWithdrawal,
      { ...validWithdrawal, amountCents: -100 },
      INITIAL_PORTFOLIO_STATE,
    );
    expect(result.ok).toBe(false);
  });
});
