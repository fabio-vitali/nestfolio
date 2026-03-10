import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard, requireEnv, extractTenantId, isRetryable, createServiceMetrics, MetricUnit, traceEvent, applyMiddleware, withLambdaContext, withTiming } from '@nestfolio/lambda-utils';
import { DecisionRepository } from '../repositories/decision.repository';
import { DecisionLifecycleService } from '../services/decision-lifecycle.service';

export interface EventListenerDeps {
  readonly idempotencyGuard: IdempotencyGuard;
  readonly lifecycleService: DecisionLifecycleService;
  readonly metrics: ReturnType<typeof createServiceMetrics>;
}

const TRIGGER_EVENT_TYPES = new Set([
  'MANDATE_GRANTED',
  'GOAL_UPDATED',
  'RISK_PROFILE_UPDATED',
  'OPERATING_MODE_CHANGED',
  'PORTFOLIO_DRIFT_DETECTED',
  'ORDER_FILLED',
  'ORDER_REJECTED',
  'ORDER_CANCELLED',
  'DEPOSIT_DETECTED',
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

        await deps.lifecycleService.executeDecisionLifecycle({
          tenantId,
          triggerEvent: uow.event,
          investorProfile: (uow.event.subject as Record<string, unknown>) ?? {},
          portfolioState: {},
        });
        deps.metrics.addMetric('EventProcessed', MetricUnit.Count, 1);
      } catch (error) {
        logger.error('Failed to process record', {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        if (isRetryable(error)) {
          failures.push(record.messageId);
        }
        deps.metrics.addMetric('EventFailed', MetricUnit.Count, 1);
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
const repository = new DecisionRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);
const lifecycleService = new DecisionLifecycleService(repository);

const deps: EventListenerDeps = {
  idempotencyGuard,
  lifecycleService,
  metrics: createServiceMetrics('advisory-ctrl'),
};

export const handler = applyMiddleware(
  createHandler(deps) as (event: unknown) => Promise<SQSBatchResponse>,
  withLambdaContext(),
  withTiming('advisory-ctrl-event-listener'),
);
