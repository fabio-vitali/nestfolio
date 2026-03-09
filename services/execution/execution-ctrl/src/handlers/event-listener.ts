import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard, requireEnv, isRetryable, createServiceMetrics, MetricUnit, traceEvent } from '@nestfolio/lambda-utils';
import { OrderRepository } from '../repositories/order.repository';
import { SafetyChecksService } from '../services/safety-checks.service';
import { MarketHoursService } from '../services/market-hours.service';
import { OrderLifecycleService } from '../services/order-lifecycle.service';

const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new OrderRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);
const safetyChecks = new SafetyChecksService(repository);
const marketHours = new MarketHoursService();
const lifecycleService = new OrderLifecycleService(repository, safetyChecks, marketHours);
const metrics = createServiceMetrics('execution-ctrl');

const HANDLED_EVENT_TYPES = new Set([
  'DECISION_APPROVED',
  'USER_CONFIRMED',
  'CIRCUIT_BREAKER_TRIGGERED',
  'CIRCUIT_BREAKER_RESET',
  'ACCOUNT_CLOSURE_REQUESTED',
]);

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: string[] = [];

  for (const record of event.Records) {
    try {
      const uow = parseRecord(record);
      const eventType = uow.event.type;

      logger.info('Processing event', { eventType, eventId: uow.event.id });
      traceEvent(eventType, uow.event.id);

      if (!HANDLED_EVENT_TYPES.has(eventType)) {
        logger.warn('No handler for event type, skipping', { eventType });
        continue;
      }

      const isNew = await idempotencyGuard.ensureOnce(eventType, uow.event.id);
      if (!isNew) {
        logger.info('Duplicate event, skipping', { eventType, eventId: uow.event.id });
        continue;
      }

      switch (eventType) {
        case 'DECISION_APPROVED':
        case 'USER_CONFIRMED':
          await lifecycleService.processApprovedDecision(uow.event);
          break;
        case 'CIRCUIT_BREAKER_TRIGGERED':
          logger.info('Circuit breaker triggered — execution paused', { eventId: uow.event.id });
          break;
        case 'CIRCUIT_BREAKER_RESET':
          logger.info('Circuit breaker reset — execution resumed', { eventId: uow.event.id });
          break;
        case 'ACCOUNT_CLOSURE_REQUESTED':
          logger.info('Account closure requested', { eventId: uow.event.id });
          break;
      }

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
