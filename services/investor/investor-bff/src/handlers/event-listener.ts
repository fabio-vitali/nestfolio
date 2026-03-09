import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger, type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard, requireEnv, isRetryable, createServiceMetrics, MetricUnit, traceEvent } from '@nestfolio/lambda-utils';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';
import { UserRegisteredPipe } from '../pipes/user-registered.pipe';
import { NotificationCreatedPipe } from '../pipes/notification-created.pipe';
import { DepositDetectedPipe } from '../pipes/deposit-detected.pipe';
import { WithdrawalCompletedPipe } from '../pipes/withdrawal-completed.pipe';

const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new InvestorProfileRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);

const userRegisteredPipe = new UserRegisteredPipe(repository, idempotencyGuard);
const notificationCreatedPipe = new NotificationCreatedPipe(repository);
const depositDetectedPipe = new DepositDetectedPipe(repository);
const withdrawalCompletedPipe = new WithdrawalCompletedPipe(repository);
const metrics = createServiceMetrics('investor-bff');

const TRIGGER_EVENT_TYPES = new Set([
  'USER_REGISTERED',
  'NOTIFICATION_CREATED',
  'DEPOSIT_DETECTED',
  'WITHDRAWAL_COMPLETED',
]);

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: string[] = [];

  for (const record of event.Records) {
    try {
      const uow = parseRecord(record);
      const eventType = uow.event.type;

      logger.info('Processing event', { eventType, eventId: uow.event.id });
      traceEvent(eventType, uow.event.id);

      if (!TRIGGER_EVENT_TYPES.has(eventType)) {
        logger.warn('No handler for event type, skipping', { eventType });
        continue;
      }

      await processEvent(eventType, uow);
      metrics.addMetric('EventProcessed', MetricUnit.Count, 1);
    } catch (error) {
      logger.error('Failed to process record', {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      metrics.addMetric('EventFailed', MetricUnit.Count, 1);
      if (isRetryable(error)) {
        failures.push(record.messageId);
      }
    }
  }

  metrics.publishStoredMetrics();

  return {
    batchItemFailures: failures.map((id) => ({ itemIdentifier: id })),
  };
};

async function processEvent(
  eventType: string,
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): Promise<void> {
  switch (eventType) {
    case 'USER_REGISTERED':
      await userRegisteredPipe.process(uow as any);
      break;
    case 'NOTIFICATION_CREATED':
      await notificationCreatedPipe.process(uow as any);
      break;
    case 'DEPOSIT_DETECTED':
      await depositDetectedPipe.process(uow as any);
      break;
    case 'WITHDRAWAL_COMPLETED':
      await withdrawalCompletedPipe.process(uow as any);
      break;
  }
}
