import { createHandlers } from '../../src/handlers/event-listener';
import { InvestorBffEventTypes } from '../../src/domain/events';
import { InvestorCtrlEventTypes } from '@nestfolio/investor-ctrl/events';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';

describe('investor-bff event-listener', () => {
  it('should export handlers for all event types', () => {
    const handlers = createHandlers();

    expect(Object.keys(handlers)).toHaveLength(4);
    expect(handlers).toHaveProperty(InvestorBffEventTypes.USER_REGISTERED);
    expect(handlers).toHaveProperty(InvestorCtrlEventTypes.NOTIFICATION_CREATED);
    expect(handlers).toHaveProperty(LedgerCrossDomainEventTypes.BALANCE_UPDATED);
    expect(handlers).toHaveProperty(InvestorBffEventTypes.ONBOARDING_COMPLETED);
  });
});
