import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard, requireEnv, extractTenantId } from '@nestfolio/lambda-utils';
import { NotificationRepository } from '../repositories/notification.repository';
import { NotificationLifecycleService } from '../services/notification-lifecycle.service';

const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new NotificationRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);
const lifecycleService = new NotificationLifecycleService(repository);

const TRIGGER_EVENT_TYPES = new Set([
  'ONBOARDING_COMPLETED',
  'MANDATE_GRANTED',
  'GOAL_UPDATED',
  'DEPOSIT_INITIATED',
  'OPERATING_MODE_CHANGED',
  'DECISION_APPROVED',
  'ORDER_FILLED',
]);

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: string[] = [];

  for (const record of event.Records) {
    try {
      const uow = parseRecord(record);
      const eventType = uow.event.type;

      logger.info('Processing event', { eventType, eventId: uow.event.id });

      if (!TRIGGER_EVENT_TYPES.has(eventType)) {
        logger.warn('No handler for event type, skipping', { eventType });
        continue;
      }

      const isNew = await idempotencyGuard.ensureOnce(eventType, uow.event.id);
      if (!isNew) {
        logger.info('Duplicate event, skipping', { eventType, eventId: uow.event.id });
        continue;
      }

      const tenantId = extractTenantId(uow.event as unknown as Record<string, unknown>);

      await lifecycleService.executeNotificationLifecycle({
        tenantId,
        triggerEvent: uow.event,
      });
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
