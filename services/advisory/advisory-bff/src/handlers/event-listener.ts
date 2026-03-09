import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger, type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard, requireEnv, isRetryable, createServiceMetrics, MetricUnit, traceEvent } from '@nestfolio/lambda-utils';
import { AdvisoryRepository } from '../repositories/advisory.repository';
import { DecisionPacketCreatedPipe } from '../pipes/decision-packet-created.pipe';
import { DecisionStatusChangedPipe } from '../pipes/decision-status-changed.pipe';

const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new AdvisoryRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);

const decisionPacketCreatedPipe = new DecisionPacketCreatedPipe(repository, idempotencyGuard);
const decisionStatusChangedPipe = new DecisionStatusChangedPipe(repository);
const metrics = createServiceMetrics('advisory-bff');

const TRIGGER_EVENT_TYPES = new Set([
  'DECISION_PACKET_CREATED',
  'DECISION_PACKET_ENRICHED',
  'DECISION_APPROVED',
  'DECISION_BLOCKED',
  'USER_CONFIRMATION_REQUESTED',
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

      const isNew = await idempotencyGuard.ensureOnce(eventType, uow.event.id);
      if (!isNew) {
        logger.info('Duplicate event, skipping', { eventId: uow.event.id });
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
    case 'DECISION_PACKET_CREATED':
      await decisionPacketCreatedPipe.process(uow as any);
      break;
    case 'DECISION_PACKET_ENRICHED':
    case 'DECISION_APPROVED':
    case 'DECISION_BLOCKED':
    case 'USER_CONFIRMATION_REQUESTED':
      await decisionStatusChangedPipe.process(uow as any);
      break;
  }
}
