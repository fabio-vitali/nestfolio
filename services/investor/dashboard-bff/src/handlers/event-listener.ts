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

// Map event types to the pipes they should trigger
const EVENT_PIPE_MAP: Record<string, Array<{ feed: (s: Highland.Stream<any>) => Highland.Stream<any> }>> = {
  // Execution events (forwarded from execution-hub → investor-bus)
  ORDER_FILLED: [portfolioSummaryPipe, positionSnapshotPipe, recentActivityPipe],
  ORDER_PARTIALLY_FILLED: [portfolioSummaryPipe, positionSnapshotPipe, recentActivityPipe],
  CORPORATE_ACTION_APPLIED: [portfolioSummaryPipe, positionSnapshotPipe],
  RECONCILIATION_COMPLETED: [portfolioSummaryPipe],
  DEPOSIT_DETECTED: [recentActivityPipe],
  WITHDRAWAL_COMPLETED: [recentActivityPipe],

  // Advisory events (forwarded from advisory-hub → investor-bus)
  DECISION_PACKET_CREATED: [advisoryStatusPipe],
  USER_CONFIRMATION_REQUESTED: [advisoryStatusPipe],
  DECISION_APPROVED: [advisoryStatusPipe, recentActivityPipe],
  DECISION_BLOCKED: [advisoryStatusPipe, recentActivityPipe],

  // Investor events (native on investor-bus)
  ONBOARDING_COMPLETED: [investorSnapshotPipe],
  GOAL_SET: [investorSnapshotPipe],
  GOAL_UPDATED: [investorSnapshotPipe],
  RISK_PROFILE_SET: [investorSnapshotPipe],
  RISK_PROFILE_UPDATED: [investorSnapshotPipe],
};

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: string[] = [];

  for (const record of event.Records) {
    try {
      const uow = parseRecord(record);
      const eventType = uow.event.type;

      logger.info('Processing event', { eventType, eventId: uow.event.id });

      const isNew = await idempotencyGuard.ensureOnce(eventType, uow.event.id);
      if (!isNew) {
        logger.info('Duplicate event, skipping', { eventId: uow.event.id });
        continue;
      }

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
  const pipes = EVENT_PIPE_MAP[eventType];

  if (!pipes || pipes.length === 0) {
    logger.info('No pipes for event type, skipping', { eventType });
    return;
  }

  // Run all applicable pipes sequentially for this event
  for (const pipe of pipes) {
    await new Promise<void>((resolve, reject) => {
      const source = Highland<UnitOfWork<BusEvent<Record<string, unknown>>>>([uow]);

      pipe.feed(source).done(() => resolve());

      source.on('error', (err: Error) => reject(err));
    });
  }
}
