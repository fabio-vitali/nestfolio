import { createHandlers } from '../../src/handlers/event-listener';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';
import { AdvisoryCrossDomainEventTypes } from '@nestfolio/advisory-adpt/domain';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';

describe('dashboard-bff event-listener', () => {
  it('should export handlers for all 14 event types', () => {
    const handlers = createHandlers();

    expect(Object.keys(handlers)).toHaveLength(14);

    // Ledger events
    expect(handlers).toHaveProperty(LedgerCrossDomainEventTypes.BALANCE_UPDATED);
    expect(handlers).toHaveProperty(LedgerCrossDomainEventTypes.PORTFOLIO_UPDATED);
    expect(handlers).toHaveProperty(LedgerCrossDomainEventTypes.RECONCILIATION_COMPLETED);
    expect(handlers).toHaveProperty(LedgerCrossDomainEventTypes.LEDGER_ENTRY_RECORDED);

    // Advisory events
    expect(handlers).toHaveProperty(AdvisoryCrossDomainEventTypes.DECISION_PACKET_CREATED);
    expect(handlers).toHaveProperty(AdvisoryCrossDomainEventTypes.USER_CONFIRMATION_REQUESTED);
    expect(handlers).toHaveProperty(AdvisoryCrossDomainEventTypes.DECISION_APPROVED);
    expect(handlers).toHaveProperty(AdvisoryCrossDomainEventTypes.DECISION_BLOCKED);

    // Investor-bff events
    expect(handlers).toHaveProperty(InvestorBffEventTypes.GOAL_CREATED);
    expect(handlers).toHaveProperty(InvestorBffEventTypes.GOAL_UPDATED);
    expect(handlers).toHaveProperty(InvestorBffEventTypes.RISK_PROFILE_CREATED);
    expect(handlers).toHaveProperty(InvestorBffEventTypes.RISK_PROFILE_UPDATED);
    expect(handlers).toHaveProperty(InvestorBffEventTypes.OPERATING_MODE_SELECTED);
    expect(handlers).toHaveProperty(InvestorBffEventTypes.OPERATING_MODE_CHANGED);
  });
});
