import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import Highland from 'highland';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger, type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard, requireEnv } from '@nestfolio/lambda-utils';
import { DashboardRepository } from '../repositories/dashboard.repository';
import { PortfolioSummaryPipe } from '../pipes/portfolio-summary.pipe';
import { PositionSnapshotPipe } from '../pipes/position-snapshot.pipe';
import { RecentActivityPipe } from '../pipes/recent-activity.pipe';
import { AdvisoryStatusPipe } from '../pipes/advisory-status.pipe';
import { InvestorSnapshotPipe } from '../pipes/investor-snapshot.pipe';

const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new DashboardRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);

const portfolioSummaryPipe = new PortfolioSummaryPipe(repository);
const positionSnapshotPipe = new PositionSnapshotPipe(repository);
const recentActivityPipe = new RecentActivityPipe(repository);
const advisoryStatusPipe = new AdvisoryStatusPipe(repository);
const investorSnapshotPipe = new InvestorSnapshotPipe(repository);

interface NamedPipe {
  name: string;
  pipe: { feed: (s: Highland.Stream<any>) => Highland.Stream<any> };
}

// Map event types to the pipes they should trigger
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

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: string[] = [];

  for (const record of event.Records) {
    try {
      const uow = parseRecord(record);
      const eventType = uow.event.type;

      logger.info('Processing event', { eventType, eventId: uow.event.id });

      await processEvent(eventType, uow);
    } catch (error) {
      logger.error('Failed to process record', {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      failures.push(record.messageId);
    }
  }

  return {
    batchItemFailures: failures.map((id) => ({ itemIdentifier: id })),
  };
};

async function processEvent(
  eventType: string,
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): Promise<void> {
  const namedPipes = EVENT_PIPE_MAP[eventType];

  if (!namedPipes || namedPipes.length === 0) {
    logger.info('No pipes for event type, skipping', { eventType });
    return;
  }

  // Run all applicable pipes sequentially, with per-pipe idempotency
  for (const { name: pipeName, pipe } of namedPipes) {
    const pipeKey = `${eventType}#${uow.event.id}#${pipeName}`;
    const isNew = await idempotencyGuard.ensureOnce(eventType, pipeKey);
    if (!isNew) {
      logger.info('Pipe already processed, skipping', { eventType, pipeName, eventId: uow.event.id });
      continue;
    }

    await new Promise<void>((resolve, reject) => {
      const source = Highland<UnitOfWork<BusEvent<Record<string, unknown>>>>([uow]);

      source.on('error', (err: Error) => reject(err));
      pipe.feed(source).done(() => resolve());
    });
  }
}
