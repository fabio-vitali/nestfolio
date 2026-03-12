import { applyCommand } from '../../../src/command';
import { INITIAL_PORTFOLIO_STATE } from '../../../src/state/account-state';
import { RecordDeposit } from '../../../src/commands/ledger/record-deposit';

const validDeposit = {
  depositId: 'dep-1',
  amountCents: 500_000, // $5,000
  depositedAt: '2026-01-15T10:00:00.000Z',
};

describe('RecordDeposit', () => {
  it('should have type RecordDeposit', () => {
    expect(RecordDeposit.type).toBe('RecordDeposit');
  });

  it('should increase cash balance', () => {
    const result = applyCommand(RecordDeposit, validDeposit, INITIAL_PORTFOLIO_STATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextState.cashBalanceCents).toBe(10_000_000 + 500_000);
  });

  it('should not affect positions', () => {
    const result = applyCommand(RecordDeposit, validDeposit, INITIAL_PORTFOLIO_STATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextState.positions).toEqual({});
  });

  it('should reject non-integer amount', () => {
    const result = applyCommand(
      RecordDeposit,
      { ...validDeposit, amountCents: 100.5 },
      INITIAL_PORTFOLIO_STATE,
    );
    expect(result.ok).toBe(false);
  });

  it('should reject zero amount', () => {
    const result = applyCommand(
      RecordDeposit,
      { ...validDeposit, amountCents: 0 },
      INITIAL_PORTFOLIO_STATE,
    );
    expect(result.ok).toBe(false);
  });
});
