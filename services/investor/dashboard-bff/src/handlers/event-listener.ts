import { materializeToTable, toUow } from '@nestfolio/event-processor';
import type { EventPayload, EventContext } from '@nestfolio/event-processor';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';
import { AdvisoryCrossDomainEventTypes } from '@nestfolio/advisory-adpt/domain';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';
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
    ],
    [LedgerCrossDomainEventTypes.PORTFOLIO_UPDATED]: (payload: EventPayload, ctx: EventContext) => [
      portfolioSummary(toUow(payload, ctx)),
      positionSnapshot(toUow(payload, ctx)),
      recentActivity(toUow(payload, ctx)),
    ],
    [LedgerCrossDomainEventTypes.RECONCILIATION_COMPLETED]: (payload: EventPayload, ctx: EventContext) =>
      portfolioSummary(toUow(payload, ctx)),
    [AdvisoryCrossDomainEventTypes.DECISION_PACKET_CREATED]: (payload: EventPayload, ctx: EventContext) =>
      advisoryStatus(toUow(payload, ctx)),
    [AdvisoryCrossDomainEventTypes.USER_CONFIRMATION_REQUESTED]: (payload: EventPayload, ctx: EventContext) =>
      advisoryStatus(toUow(payload, ctx)),
    [AdvisoryCrossDomainEventTypes.DECISION_APPROVED]: (payload: EventPayload, ctx: EventContext) => [
      advisoryStatus(toUow(payload, ctx)),
      recentActivity(toUow(payload, ctx)),
    ],
    [AdvisoryCrossDomainEventTypes.DECISION_BLOCKED]: (payload: EventPayload, ctx: EventContext) => [
      advisoryStatus(toUow(payload, ctx)),
      recentActivity(toUow(payload, ctx)),
    ],
    [LedgerCrossDomainEventTypes.LEDGER_ENTRY_RECORDED]: (payload: EventPayload, ctx: EventContext) =>
      timeTravelAvailability(toUow(payload, ctx)),
    [InvestorBffEventTypes.GOAL_SET]: (payload: EventPayload, ctx: EventContext) =>
      investorSnapshot(toUow(payload, ctx)),
    [InvestorBffEventTypes.GOAL_UPDATED]: (payload: EventPayload, ctx: EventContext) =>
      investorSnapshot(toUow(payload, ctx)),
    [InvestorBffEventTypes.RISK_PROFILE_SET]: (payload: EventPayload, ctx: EventContext) =>
      investorSnapshot(toUow(payload, ctx)),
    [InvestorBffEventTypes.RISK_PROFILE_UPDATED]: (payload: EventPayload, ctx: EventContext) =>
      investorSnapshot(toUow(payload, ctx)),
    [InvestorBffEventTypes.OPERATING_MODE_SELECTED]: (payload: EventPayload, ctx: EventContext) =>
      investorSnapshot(toUow(payload, ctx)),
    [InvestorBffEventTypes.OPERATING_MODE_CHANGED]: (payload: EventPayload, ctx: EventContext) =>
      investorSnapshot(toUow(payload, ctx)),
  };
}

export const handler = materializeToTable({
  serviceName: 'dashboard-bff',
  handlers: createHandlers(),
  errorEventType: 'DASHBOARD_BFF_FAILED',
});
