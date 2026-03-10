import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard, requireEnv, extractTenantId, isRetryable, createServiceMetrics, MetricUnit, traceEvent, applyMiddleware, withLambdaContext, withTiming } from '@nestfolio/lambda-utils';
import { NotificationRepository } from '../repositories/notification.repository';
import { NotificationLifecycleService } from '../services/notification-lifecycle.service';

export interface EventListenerDeps {
  readonly idempotencyGuard: IdempotencyGuard;
  readonly lifecycleService: NotificationLifecycleService;
  readonly metrics: ReturnType<typeof createServiceMetrics>;
}

const TRIGGER_EVENT_TYPES = new Set([
  'ONBOARDING_COMPLETED',
  'MANDATE_GRANTED',
  'GOAL_UPDATED',
  'DEPOSIT_INITIATED',
  'OPERATING_MODE_CHANGED',
  'DECISION_APPROVED',
  'ORDER_FILLED',
]);

export const createHandler = (deps: EventListenerDeps) =>
  async (event: SQSEvent): Promise<SQSBatchResponse> => {
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

        const isNew = await deps.idempotencyGuard.ensureOnce(eventType, uow.event.id);
        if (!isNew) {
          logger.info('Duplicate event, skipping', { eventType, eventId: uow.event.id });
          continue;
        }

        const tenantId = extractTenantId(uow.event as unknown as Record<string, unknown>);

        await deps.lifecycleService.executeNotificationLifecycle({
          tenantId,
          triggerEvent: uow.event,
        });

        deps.metrics.addMetric('EventProcessed', MetricUnit.Count, 1);
      } catch (error) {
        logger.error('Failed to process record', {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
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

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new NotificationRepository(TABLE_NAME, dynamoClient);

const deps: EventListenerDeps = {
  idempotencyGuard: new IdempotencyGuard(dynamoClient, TABLE_NAME),
  lifecycleService: new NotificationLifecycleService(repository),
  metrics: createServiceMetrics('investor-ctrl'),
};

export const handler = applyMiddleware(
  createHandler(deps) as (event: unknown) => Promise<SQSBatchResponse>,
  withLambdaContext(),
  withTiming('investor-ctrl-event-listener'),
);
