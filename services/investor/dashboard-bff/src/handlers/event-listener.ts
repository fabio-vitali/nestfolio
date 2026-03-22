import { materializeToTable, toUow } from '@nestfolio/event-processor';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';
import { AdvisoryCrossDomainEventTypes } from '@nestfolio/advisory-adpt/domain';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';
import { portfolioSummary } from '../transforms/portfolio-summary';
import { positionSnapshot } from '../transforms/position-snapshot';
import { recentActivity } from '../transforms/recent-activity';
import { advisoryStatus } from '../transforms/advisory-status';
import { investorSnapshot } from '../transforms/investor-snapshot';
import { timeTravelAvailability } from '../transforms/time-travel-availability';

export const handler = materializeToTable({
  serviceName: 'dashboard-bff',
  handlers: {
    [LedgerCrossDomainEventTypes.BALANCE_UPDATED]: (payload, ctx) => [
      portfolioSummary(toUow(payload, ctx)),
      recentActivity(toUow(payload, ctx)),
    ],
    [LedgerCrossDomainEventTypes.PORTFOLIO_UPDATED]: (payload, ctx) => [
      portfolioSummary(toUow(payload, ctx)),
      positionSnapshot(toUow(payload, ctx)),
      recentActivity(toUow(payload, ctx)),
    ],
    [LedgerCrossDomainEventTypes.RECONCILIATION_COMPLETED]: (payload, ctx) =>
      portfolioSummary(toUow(payload, ctx)),
    [AdvisoryCrossDomainEventTypes.DECISION_PACKET_CREATED]: (payload, ctx) =>
      advisoryStatus(toUow(payload, ctx)),
    [AdvisoryCrossDomainEventTypes.USER_CONFIRMATION_REQUESTED]: (payload, ctx) =>
      advisoryStatus(toUow(payload, ctx)),
    [AdvisoryCrossDomainEventTypes.DECISION_APPROVED]: (payload, ctx) => [
      advisoryStatus(toUow(payload, ctx)),
      recentActivity(toUow(payload, ctx)),
    ],
    [AdvisoryCrossDomainEventTypes.DECISION_BLOCKED]: (payload, ctx) => [
      advisoryStatus(toUow(payload, ctx)),
      recentActivity(toUow(payload, ctx)),
    ],
    [LedgerCrossDomainEventTypes.LEDGER_ENTRY_RECORDED]: (payload, ctx) =>
      timeTravelAvailability(toUow(payload, ctx)),
    [InvestorBffEventTypes.ONBOARDING_COMPLETED]: (payload, ctx) =>
      investorSnapshot(toUow(payload, ctx)),
    [InvestorBffEventTypes.GOAL_SET]: (payload, ctx) =>
      investorSnapshot(toUow(payload, ctx)),
    [InvestorBffEventTypes.GOAL_UPDATED]: (payload, ctx) =>
      investorSnapshot(toUow(payload, ctx)),
    [InvestorBffEventTypes.RISK_PROFILE_SET]: (payload, ctx) =>
      investorSnapshot(toUow(payload, ctx)),
    [InvestorBffEventTypes.RISK_PROFILE_UPDATED]: (payload, ctx) =>
      investorSnapshot(toUow(payload, ctx)),
  },
  errorEventType: 'DASHBOARD_BFF_FAILED',
});
