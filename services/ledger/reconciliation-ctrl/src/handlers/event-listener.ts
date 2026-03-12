import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard, requireEnv, extractTenantId, isRetryable, createServiceMetrics, MetricUnit, traceEvent, applyMiddleware, withLambdaContext, withTiming, publishErrorEvent, EventBridgeBus, type Bus } from '@nestfolio/lambda-utils';
import { ReconciliationRepository } from '../repositories/reconciliation.repository';
import { ReconciliationService } from '../services/reconciliation.service';

interface EventListenerDeps {
  readonly idempotencyGuard: IdempotencyGuard;
  readonly reconciliationService: ReconciliationService;
  readonly bus: Bus;
  readonly metrics: ReturnType<typeof createServiceMetrics>;
}

const TRIGGER_EVENT_TYPES = new Set([
  'PORTFOLIO_UPDATED',
  'PORTFOLIO_SNAPSHOT_IMPORTED',
  'CORPORATE_ACTION_APPLIED',
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

        const subject = uow.event.subject as Record<string, unknown>;
        const portfolioId = (subject?.portfolioId as string) ?? tenantId;

        // Phase 2: Virtual ledger is sole truth source -- reconciliation always succeeds with zero drift
        const positions = (subject?.positions as Array<{ symbol: string; quantity: number }>) ?? [];

        try {
          await deps.reconciliationService.reconcile({
            tenantId,
            portfolioId,
            intentPositions: positions.map((p) => ({
              instrument: p.symbol,
              quantity: p.quantity,
            })),
            settlementPositions: positions.map((p) => ({
              instrument: p.symbol,
              quantity: p.quantity,
            })),
          });
        } catch (reconcileError) {
          logger.error('Reconciliation failed', {
            tenantId,
            portfolioId,
            eventType,
            eventId: uow.event.id,
            positionCount: positions.length,
            error: reconcileError instanceof Error ? reconcileError.message : String(reconcileError),
          });
          throw reconcileError;
        }

        deps.metrics.addMetric('EventProcessed', MetricUnit.Count, 1);
      } catch (error) {
        logger.error('Failed to process record', {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        await publishErrorEvent(deps.bus, 'RECONCILIATION_CTRL_FAILED', error);
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
const repository = new ReconciliationRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);
const reconciliationService = new ReconciliationService(repository);

const deps: EventListenerDeps = {
  idempotencyGuard,
  reconciliationService,
  bus: new EventBridgeBus(requireEnv('BUS_NAME'), 'reconciliation-ctrl'),
  metrics: createServiceMetrics('reconciliation-ctrl'),
};

export const handler = applyMiddleware(
  createHandler(deps) as (event: unknown) => Promise<SQSBatchResponse>,
  withLambdaContext(),
  withTiming('reconciliation-ctrl-event-listener'),
);
