import { applyCommand } from '../../../src/command';
import { INITIAL_PORTFOLIO_STATE } from '../../../src/state/account-state';
import { CancelOrder } from '../../../src/commands/order/cancel-order';

const validCancel = {
  orderId: 'ord-1',
  symbol: 'VTI',
  cancelledAt: '2026-01-15T10:00:00.000Z',
};

describe('CancelOrder', () => {
  it('should have type CancelOrder', () => {
    expect(CancelOrder.type).toBe('CancelOrder');
  });

  it('should not change portfolio state (no fill occurred)', () => {
    const result = applyCommand(CancelOrder, validCancel, INITIAL_PORTFOLIO_STATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextState).toEqual(INITIAL_PORTFOLIO_STATE);
  });

  it('should accept optional reason', () => {
    const result = applyCommand(
      CancelOrder,
      { ...validCancel, reason: 'Market closed' },
      INITIAL_PORTFOLIO_STATE,
    );
    expect(result.ok).toBe(true);
  });

  it('should reject missing orderId', () => {
    const result = applyCommand(
      CancelOrder,
      { ...validCancel, orderId: '' },
      INITIAL_PORTFOLIO_STATE,
    );
    expect(result.ok).toBe(false);
  });
});
