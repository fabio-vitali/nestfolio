import { createHandlers } from '../../../src/handlers/event-listener';

describe('event-listener handler registry', () => {
  it('registers exactly the expected event types', () => {
    const handlerKeys = Object.keys(createHandlers()).sort();
    expect(handlerKeys).toEqual(
      [
        'USER_REGISTERED',
        'NOTIFICATION_CREATED',
        'BALANCE_UPDATED',
        'ONBOARDING_COMPLETED',
        'GO_LIVE_CONFIRMED',
        // funding lifecycle from broker-ctrl → Deposit/WithdrawalRequest P1 rows
        'DEPOSIT_REQUESTED',
        'DEPOSIT_DETECTED',
        'DEPOSIT_SETTLED',
        'DEPOSIT_FAILED',
        'WITHDRAWAL_REQUESTED',
        'WITHDRAWAL_SETTLED',
        'WITHDRAWAL_FAILED',
      ].sort(),
    );
  });
});
