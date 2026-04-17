import { applyCommand } from '@nestfolio/event-processor/sourcing';
import { INITIAL_ACCOUNT_STATE } from '../../../src/domain/account-state';
import { CancelOrder } from '../../../src/domain/cancel-order';

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
    const result = applyCommand(CancelOrder, validCancel, INITIAL_ACCOUNT_STATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextState).toEqual(INITIAL_ACCOUNT_STATE);
  });

  it('should accept optional reason', () => {
    const result = applyCommand(
      CancelOrder,
      { ...validCancel, reason: 'Market closed' },
      INITIAL_ACCOUNT_STATE,
    );
    expect(result.ok).toBe(true);
  });

  it('should reject missing orderId', () => {
    const result = applyCommand(
      CancelOrder,
      { ...validCancel, orderId: '' },
      INITIAL_ACCOUNT_STATE,
    );
    expect(result.ok).toBe(false);
  });
});
