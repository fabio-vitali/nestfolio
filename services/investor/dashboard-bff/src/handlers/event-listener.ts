import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger, type BusEvent, type Pipe, type UnitOfWork } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard, requireEnv, isRetryable, createServiceMetrics, MetricUnit, traceEvent, applyMiddleware, withLambdaContext, withTiming, publishErrorEvent, EventBridgeBus, type Bus } from '@nestfolio/lambda-utils';
import { DashboardRepository } from '../repositories/dashboard.repository';
import { PortfolioSummaryPipe } from '../pipes/portfolio-summary.pipe';
import { PositionSnapshotPipe } from '../pipes/position-snapshot.pipe';
import { RecentActivityPipe } from '../pipes/recent-activity.pipe';
import { AdvisoryStatusPipe } from '../pipes/advisory-status.pipe';
import { InvestorSnapshotPipe } from '../pipes/investor-snapshot.pipe';
import { TimeTravelAvailabilityPipe } from '../pipes/time-travel-availability.pipe';
import { SimulationSummaryPipe } from '../pipes/simulation-summary.pipe';

interface NamedPipe {
  name: string;
  pipe: Pipe<UnitOfWork<BusEvent<Record<string, unknown>>>>;
}

export interface EventListenerDeps {
  readonly idempotencyGuard: IdempotencyGuard;
  readonly eventPipeMap: Record<string, NamedPipe[]>;
  readonly bus: Bus;
  readonly metrics: ReturnType<typeof createServiceMetrics>;
}

export const createHandler = (deps: EventListenerDeps) =>
  async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const failures: string[] = [];

    for (const record of event.Records) {
      try {
        const uow = parseRecord(record);
        const eventType = uow.event.type;

        logger.info('Processing event', { eventType, eventId: uow.event.id });
        traceEvent(eventType, uow.event.id);

        await processEvent(deps, eventType, uow);
        deps.metrics.addMetric('EventProcessed', MetricUnit.Count, 1);
      } catch (error) {
        logger.error('Failed to process record', {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        await publishErrorEvent(deps.bus, 'DASHBOARD_BFF_FAILED', error);
        deps.metrics.addMetric('EventFailed', MetricUnit.Count, 1);
        if (isRetryable(error)) {
          failures.push(record.messageId);
        }
      }
    }

    deps.metrics.publishStoredMetrics();

    return {
      batchItemFailures: failures.map((id) => ({ itemIdentifier: id })),
    };
  };

async function processEvent(
  deps: EventListenerDeps,
  eventType: string,
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): Promise<void> {
  const namedPipes = deps.eventPipeMap[eventType];

  if (!namedPipes || namedPipes.length === 0) {
    logger.info('No pipes for event type, skipping', { eventType });
    return;
  }

  for (const { name: pipeName, pipe } of namedPipes) {
    const pipeKey = `${eventType}#${uow.event.id}#${pipeName}`;
    const isNew = await deps.idempotencyGuard.ensureOnce(eventType, pipeKey);
    if (!isNew) {
      logger.info('Pipe already processed, skipping', { eventType, pipeName, eventId: uow.event.id });
      continue;
    }

    await pipe.process(uow);
  }
}

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
const simulationSummaryPipe = new SimulationSummaryPipe(repository);

const EVENT_PIPE_MAP: Record<string, NamedPipe[]> = {
  // Execution events (forwarded from execution-hub -> investor-bus)
  ORDER_FILLED: [
    { name: 'portfolioSummary', pipe: portfolioSummaryPipe },
    { name: 'positionSnapshot', pipe: positionSnapshotPipe },
    { name: 'recentActivity', pipe: recentActivityPipe },
  ],
  ORDER_PARTIALLY_FILLED: [
    { name: 'portfolioSummary', pipe: portfolioSummaryPipe },
    { name: 'positionSnapshot', pipe: positionSnapshotPipe },
    { name: 'recentActivity', pipe: recentActivityPipe },
  ],
  CORPORATE_ACTION_APPLIED: [
    { name: 'portfolioSummary', pipe: portfolioSummaryPipe },
    { name: 'positionSnapshot', pipe: positionSnapshotPipe },
  ],
  RECONCILIATION_COMPLETED: [
    { name: 'portfolioSummary', pipe: portfolioSummaryPipe },
  ],
  DEPOSIT_DETECTED: [
    { name: 'recentActivity', pipe: recentActivityPipe },
  ],
  WITHDRAWAL_COMPLETED: [
    { name: 'recentActivity', pipe: recentActivityPipe },
  ],

  // Advisory events (forwarded from advisory-hub -> investor-bus)
  DECISION_PACKET_CREATED: [
    { name: 'advisoryStatus', pipe: advisoryStatusPipe },
  ],
  USER_CONFIRMATION_REQUESTED: [
    { name: 'advisoryStatus', pipe: advisoryStatusPipe },
  ],
  DECISION_APPROVED: [
    { name: 'advisoryStatus', pipe: advisoryStatusPipe },
    { name: 'recentActivity', pipe: recentActivityPipe },
  ],
  DECISION_BLOCKED: [
    { name: 'advisoryStatus', pipe: advisoryStatusPipe },
    { name: 'recentActivity', pipe: recentActivityPipe },
  ],

  // Order-ledger events (forwarded from execution-hub → investor-bus)
  PORTFOLIO_SNAPSHOT_UPDATED: [
    { name: 'timeTravelAvailability', pipe: timeTravelAvailabilityPipe },
    { name: 'simulationSummary', pipe: simulationSummaryPipe },
  ],

  // Investor events (native on investor-bus)
  ONBOARDING_COMPLETED: [
    { name: 'investorSnapshot', pipe: investorSnapshotPipe },
  ],
  GOAL_SET: [
    { name: 'investorSnapshot', pipe: investorSnapshotPipe },
  ],
  GOAL_UPDATED: [
    { name: 'investorSnapshot', pipe: investorSnapshotPipe },
  ],
  RISK_PROFILE_SET: [
    { name: 'investorSnapshot', pipe: investorSnapshotPipe },
  ],
  RISK_PROFILE_UPDATED: [
    { name: 'investorSnapshot', pipe: investorSnapshotPipe },
  ],
};

const deps: EventListenerDeps = {
  idempotencyGuard: new IdempotencyGuard(dynamoClient, TABLE_NAME),
  eventPipeMap: EVENT_PIPE_MAP,
  bus: new EventBridgeBus(requireEnv('BUS_NAME'), 'dashboard-bff'),
  metrics: createServiceMetrics('dashboard-bff'),
};

export const handler = applyMiddleware(
  createHandler(deps) as (event: unknown) => Promise<SQSBatchResponse>,
  withLambdaContext(),
  withTiming('dashboard-bff-event-listener'),
);
