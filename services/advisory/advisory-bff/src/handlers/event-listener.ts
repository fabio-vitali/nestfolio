import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger, type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard, requireEnv, isRetryable, createServiceMetrics, MetricUnit, traceEvent, applyMiddleware, withLambdaContext, withTiming } from '@nestfolio/lambda-utils';
import { AdvisoryRepository } from '../repositories/advisory.repository';
import { DecisionPacketCreatedPipe } from '../pipes/decision-packet-created.pipe';
import { DecisionStatusChangedPipe } from '../pipes/decision-status-changed.pipe';

export interface EventListenerDeps {
  readonly idempotencyGuard: IdempotencyGuard;
  readonly decisionPacketCreatedPipe: DecisionPacketCreatedPipe;
  readonly decisionStatusChangedPipe: DecisionStatusChangedPipe;
  readonly metrics: ReturnType<typeof createServiceMetrics>;
}

const TRIGGER_EVENT_TYPES = new Set([
  'DECISION_PACKET_CREATED',
  'DECISION_PACKET_ENRICHED',
  'DECISION_APPROVED',
  'DECISION_BLOCKED',
  'USER_CONFIRMATION_REQUESTED',
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
          logger.info('Duplicate event, skipping', { eventId: uow.event.id });
          continue;
        }

        await processEvent(deps, eventType, uow);
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

async function processEvent(
  deps: EventListenerDeps,
  eventType: string,
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): Promise<void> {
  switch (eventType) {
    case 'DECISION_PACKET_CREATED':
      await deps.decisionPacketCreatedPipe.process(uow as any);
      break;
    case 'DECISION_PACKET_ENRICHED':
    case 'DECISION_APPROVED':
    case 'DECISION_BLOCKED':
    case 'USER_CONFIRMATION_REQUESTED':
      await deps.decisionStatusChangedPipe.process(uow as any);
      break;
  }
}

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new AdvisoryRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);

const deps: EventListenerDeps = {
  idempotencyGuard,
  decisionPacketCreatedPipe: new DecisionPacketCreatedPipe(repository, idempotencyGuard),
  decisionStatusChangedPipe: new DecisionStatusChangedPipe(repository),
  metrics: createServiceMetrics('advisory-bff'),
};

export const handler = applyMiddleware(
  createHandler(deps) as (event: unknown) => Promise<SQSBatchResponse>,
  withLambdaContext(),
  withTiming('advisory-bff-event-listener'),
);
