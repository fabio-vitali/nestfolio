import '../read-model-ownership';
import { materializeToTable, toUow } from '@nestfolio/event-processor';
import type { EventPayload, EventContext } from '@nestfolio/event-processor';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';
import { AdvisoryCrossDomainEventTypes } from '@nestfolio/advisory-adpt/domain';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';
import { InvestorIngestEventTypes } from '@nestfolio/investor-adpt/domain';
import { portfolioSummary } from '../transforms/portfolio-summary';
import { positionSnapshot } from '../transforms/position-snapshot';
import { recentActivity } from '../transforms/recent-activity';
import { advisoryStatus } from '../transforms/advisory-status';
import { investorSnapshot } from '../transforms/investor-snapshot';
import { timeTravelAvailability } from '../transforms/time-travel-availability';

export function createHandlers() {
  return {
    [LedgerCrossDomainEventTypes.BALANCE_UPDATED]: (payload: EventPayload, ctx: EventContext) => [
      portfolioSummary(toUow(payload, ctx)),
      recentActivity(toUow(payload, ctx)),
    ].filter((i): i is NonNullable<typeof i> => i != null),
    [LedgerCrossDomainEventTypes.PORTFOLIO_UPDATED]: (payload: EventPayload, ctx: EventContext) => {
      const uow = toUow(payload, ctx);
      return [
        portfolioSummary(uow),
        ...positionSnapshot(uow),
        recentActivity(uow),
      ].filter((i): i is NonNullable<typeof i> => i != null);
    },
    [LedgerCrossDomainEventTypes.RECONCILIATION_COMPLETED]: (payload: EventPayload, ctx: EventContext) =>
      portfolioSummary(toUow(payload, ctx)),
    [AdvisoryCrossDomainEventTypes.DECISION_PACKET_CREATED]: (payload: EventPayload, ctx: EventContext) =>
      recentActivity(toUow(payload, ctx)),
    [AdvisoryCrossDomainEventTypes.USER_CONFIRMATION_REQUESTED]: (payload: EventPayload, ctx: EventContext) =>
      recentActivity(toUow(payload, ctx)),
    [AdvisoryCrossDomainEventTypes.DECISION_APPROVED]: (payload: EventPayload, ctx: EventContext) =>
      recentActivity(toUow(payload, ctx)),
    [AdvisoryCrossDomainEventTypes.DECISION_BLOCKED]: (payload: EventPayload, ctx: EventContext) =>
      recentActivity(toUow(payload, ctx)),
    // advisory-bff is the authoritative owner of AdvisoryStatus; we project its
    // announced aggregate (forwarded advisory→investor by investor-adpt, Task 4.1).
    [InvestorIngestEventTypes.ADVISORY_STATUS_UPDATED]: (payload: EventPayload, ctx: EventContext) =>
      advisoryStatus(toUow(payload, ctx)),
    [LedgerCrossDomainEventTypes.LEDGER_ENTRY_RECORDED]: (payload: EventPayload, ctx: EventContext) =>
      timeTravelAvailability(toUow(payload, ctx)),
    [InvestorBffEventTypes.INVESTOR_PROFILE_CREATED]: (payload: EventPayload, ctx: EventContext) =>
      investorSnapshot(toUow(payload, ctx)),
    [InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED]: (payload: EventPayload, ctx: EventContext) =>
      investorSnapshot(toUow(payload, ctx)),
    [InvestorIngestEventTypes.DEPOSIT_DETECTED]: (payload: EventPayload, ctx: EventContext) =>
      recentActivity(toUow(payload, ctx)),
    [InvestorIngestEventTypes.WITHDRAWAL_SETTLED]: (payload: EventPayload, ctx: EventContext) =>
      recentActivity(toUow(payload, ctx)),
  };
}

export const handler = materializeToTable({
  serviceName: 'dashboard-bff',
  handlers: createHandlers(),
  errorEventType: 'DASHBOARD_BFF_FAILED',
});
