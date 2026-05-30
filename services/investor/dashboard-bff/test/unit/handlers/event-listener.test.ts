import { createHandlers } from '../../../src/handlers/event-listener';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';
import { AdvisoryCrossDomainEventTypes } from '@nestfolio/advisory-adpt/domain';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';
import { InvestorIngestEventTypes } from '@nestfolio/investor-adpt/domain';

describe('dashboard-bff event-listener', () => {
  it('should export handlers for all 13 event types', () => {
    const handlers = createHandlers();

    expect(Object.keys(handlers)).toHaveLength(13);

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

    // AdvisoryStatus is projected from advisory-bff's authoritative announcement
    // (forwarded advisory→investor by investor-adpt, Task 4.1).
    expect(handlers).toHaveProperty(InvestorIngestEventTypes.ADVISORY_STATUS_UPDATED);

    // Investor-bff events (collapsed: composite InvestorProfile row)
    expect(handlers).toHaveProperty(InvestorBffEventTypes.INVESTOR_PROFILE_CREATED);
    expect(handlers).toHaveProperty(InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED);

    // Execution cross-domain events (via investor-adpt)
    expect(handlers).toHaveProperty(InvestorIngestEventTypes.DEPOSIT_DETECTED);
    expect(handlers).toHaveProperty(InvestorIngestEventTypes.WITHDRAWAL_COMPLETED);

    // ORDER_FILLED/REJECTED/CANCELLED + PORTFOLIO_DRIFT_DETECTED no longer have
    // handlers — they were the now-removed accumulate-counter triggers.
    expect(handlers).not.toHaveProperty(InvestorIngestEventTypes.ORDER_FILLED);
    expect(handlers).not.toHaveProperty(InvestorIngestEventTypes.PORTFOLIO_DRIFT_DETECTED);
  });
});
