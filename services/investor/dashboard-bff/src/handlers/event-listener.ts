import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/event-processor';
import { type BusEvent, type Pipe, type UnitOfWork } from '@nestfolio/event-processor';
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/service';
import { ReconciliationEventTypes } from '@nestfolio/reconciliation-ctrl/service';
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/service';
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/service';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/service';
import { DashboardRepository } from '../repositories/dashboard.repository';
import { PortfolioSummaryPipe } from '../pipes/portfolio-summary.pipe';
import { PositionSnapshotPipe } from '../pipes/position-snapshot.pipe';
import { RecentActivityPipe } from '../pipes/recent-activity.pipe';
import { AdvisoryStatusPipe } from '../pipes/advisory-status.pipe';
import { InvestorSnapshotPipe } from '../pipes/investor-snapshot.pipe';
import { TimeTravelAvailabilityPipe } from '../pipes/time-travel-availability.pipe';

export interface NamedPipe {
  name: string;
  pipe: Pipe<UnitOfWork<BusEvent<Record<string, unknown>>>>;
}

export interface EventListenerDeps {
  readonly eventPipeMap: Record<string, NamedPipe[]>;
}

function toUow(payload: EventPayload, ctx: EventContext) {
  const event = {
    id: ctx.eventId,
    type: ctx.eventType,
    timestamp: ctx.timestamp,
    subject: payload.subject,
    context: payload.context ?? { tenantId: ctx.tenantId },
  };
  return { event, payload: payload.subject as Record<string, unknown>, record: {} };
}

export const createHandlers = (deps: EventListenerDeps) => {
  const allEventTypes = Object.keys(deps.eventPipeMap);

  return Object.fromEntries(
    allEventTypes.map((type) => [
      type,
      async (payload: EventPayload, ctx: EventContext) => {
        const namedPipes = deps.eventPipeMap[type];
        if (!namedPipes || namedPipes.length === 0) return skip();

        const uow = toUow(payload, ctx);
        for (const { pipe } of namedPipes) {
          await pipe.process(uow);
        }
        return skip();
      },
    ]),
  );
};

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new DashboardRepository(TABLE_NAME, dynamoClient);

const portfolioSummaryPipe = new PortfolioSummaryPipe(repository);
const positionSnapshotPipe = new PositionSnapshotPipe(repository);
const recentActivityPipe = new RecentActivityPipe(repository);
const advisoryStatusPipe = new AdvisoryStatusPipe(repository);
const investorSnapshotPipe = new InvestorSnapshotPipe(repository);
const timeTravelAvailabilityPipe = new TimeTravelAvailabilityPipe(repository);

const EVENT_PIPE_MAP: Record<string, NamedPipe[]> = {
  [LedgerCtrlEventTypes.BALANCE_UPDATED]: [
    { name: 'portfolioSummary', pipe: portfolioSummaryPipe },
    { name: 'recentActivity', pipe: recentActivityPipe },
  ],
  [LedgerCtrlEventTypes.PORTFOLIO_UPDATED]: [
    { name: 'portfolioSummary', pipe: portfolioSummaryPipe },
    { name: 'positionSnapshot', pipe: positionSnapshotPipe },
    { name: 'recentActivity', pipe: recentActivityPipe },
  ],
  [ReconciliationEventTypes.RECONCILIATION_COMPLETED]: [
    { name: 'portfolioSummary', pipe: portfolioSummaryPipe },
  ],
  [AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED]: [
    { name: 'advisoryStatus', pipe: advisoryStatusPipe },
  ],
  [AdvisoryCtrlEventTypes.USER_CONFIRMATION_REQUESTED]: [
    { name: 'advisoryStatus', pipe: advisoryStatusPipe },
  ],
  [ComplianceEventTypes.DECISION_APPROVED]: [
    { name: 'advisoryStatus', pipe: advisoryStatusPipe },
    { name: 'recentActivity', pipe: recentActivityPipe },
  ],
  [ComplianceEventTypes.DECISION_BLOCKED]: [
    { name: 'advisoryStatus', pipe: advisoryStatusPipe },
    { name: 'recentActivity', pipe: recentActivityPipe },
  ],
  [LedgerCtrlEventTypes.LEDGER_ENTRY_RECORDED]: [
    { name: 'timeTravelAvailability', pipe: timeTravelAvailabilityPipe },
  ],
  [InvestorBffEventTypes.ONBOARDING_COMPLETED]: [
    { name: 'investorSnapshot', pipe: investorSnapshotPipe },
  ],
  [InvestorBffEventTypes.GOAL_SET]: [
    { name: 'investorSnapshot', pipe: investorSnapshotPipe },
  ],
  [InvestorBffEventTypes.GOAL_UPDATED]: [
    { name: 'investorSnapshot', pipe: investorSnapshotPipe },
  ],
  [InvestorBffEventTypes.RISK_PROFILE_SET]: [
    { name: 'investorSnapshot', pipe: investorSnapshotPipe },
  ],
  [InvestorBffEventTypes.RISK_PROFILE_UPDATED]: [
    { name: 'investorSnapshot', pipe: investorSnapshotPipe },
  ],
};

const deps: EventListenerDeps = {
  eventPipeMap: EVENT_PIPE_MAP,
};

export const handler = createEventHandler({
  serviceName: 'dashboard-bff',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'DASHBOARD_BFF_FAILED',
});
