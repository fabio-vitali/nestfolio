import { applyCommand } from '@nestfolio/event-processor/sourcing';
import { INITIAL_ACCOUNT_STATE } from '../../src/domain/account-state';
import { SubmitOrder } from '../../src/domain/submit-order';

const validSubmission = {
  orderId: 'ord-1',
  symbol: 'VTI',
  side: 'BUY' as const,
  quantity: 10,
  submittedAt: '2026-01-15T10:00:00.000Z',
};

describe('SubmitOrder', () => {
  it('should have type SubmitOrder', () => {
    expect(SubmitOrder.type).toBe('SubmitOrder');
  });

  it('should not change portfolio state (lifecycle marker)', () => {
    const result = applyCommand(SubmitOrder, validSubmission, INITIAL_ACCOUNT_STATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextState).toEqual(INITIAL_ACCOUNT_STATE);
  });

  it('should accept optional limitPrice', () => {
    const result = applyCommand(
      SubmitOrder,
      { ...validSubmission, limitPrice: 250.0 },
      INITIAL_ACCOUNT_STATE,
    );
    expect(result.ok).toBe(true);
  });

  it('should reject missing orderId', () => {
    const result = applyCommand(
      SubmitOrder,
      { ...validSubmission, orderId: '' },
      INITIAL_ACCOUNT_STATE,
    );
    expect(result.ok).toBe(false);
  });
});
