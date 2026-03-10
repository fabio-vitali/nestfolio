import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import {
  parseRecord,
  IdempotencyGuard,
  requireEnv,
  isRetryable,
  createServiceMetrics,
  MetricUnit,
  traceEvent,
  applyMiddleware,
  withLambdaContext,
  withTiming,
  publishErrorEvent,
  EventBridgeBus,
  type Bus,
} from '@nestfolio/lambda-utils';
import { LedgerRepository } from '../repositories/ledger.repository';

interface EventListenerDeps {
  readonly repository: LedgerRepository;
  readonly idempotencyGuard: IdempotencyGuard;
  readonly bus: Bus;
  readonly metrics: ReturnType<typeof createServiceMetrics>;
}

const HANDLED_EVENT_TYPES = new Set([
  'ORDER_FILLED',
  'ORDER_PARTIALLY_FILLED',
  'ORDER_REJECTED',
  'ORDER_CANCELLED',
  'DEPOSIT_DETECTED',
  'WITHDRAWAL_COMPLETED',
]);

function extractTenantId(event: Record<string, unknown>): string {
  const context = (event['context'] ?? {}) as Record<string, unknown>;
  const subject = (event['subject'] ?? {}) as Record<string, unknown>;
  return (context['tenantId'] as string) ?? (subject['tenantId'] as string) ?? 'unknown';
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

        if (!HANDLED_EVENT_TYPES.has(eventType)) {
          logger.warn('No handler for event type, skipping', { eventType });
          continue;
        }

        const isNew = await deps.idempotencyGuard.ensureOnce(eventType, uow.event.id);
        if (!isNew) {
          logger.info('Duplicate event, skipping', { eventType, eventId: uow.event.id });
          continue;
        }

        const tenantId = extractTenantId(uow.event);
        const subject = (uow.event.subject ?? {}) as Record<string, unknown>;
        const orderId = (subject['orderId'] as string) ?? uow.event.id;

        const sequenceNo = await deps.repository.nextSequence(tenantId, 'actual', orderId);

        await deps.repository.putLedgerEntry({
          tenantId,
          streamType: 'actual',
          orderId,
          eventId: uow.event.id,
          eventType,
          payload: subject,
          timestamp: uow.event.timestamp,
          sequenceNo,
          decisionId: subject['decisionId'] as string | undefined,
        });

        deps.metrics.addMetric('EventProcessed', MetricUnit.Count, 1);
      } catch (error) {
        logger.error('Failed to process record', {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        await publishErrorEvent(deps.bus, 'ORDER_LEDGER_FAILED', error);
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
const repository = new LedgerRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);

const deps: EventListenerDeps = {
  repository,
  idempotencyGuard,
  bus: new EventBridgeBus(requireEnv('BUS_NAME'), 'order-ledger'),
  metrics: createServiceMetrics('order-ledger'),
};

export const handler = applyMiddleware(
  createHandler(deps) as (event: unknown) => Promise<SQSBatchResponse>,
  withLambdaContext(),
  withTiming('order-ledger-event-listener'),
);
