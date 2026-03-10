import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard, requireEnv, isRetryable, NotRetryableError, createServiceMetrics, MetricUnit, traceEvent, applyMiddleware, withLambdaContext, withTiming, publishErrorEvent, EventBridgeBus, type Bus } from '@nestfolio/lambda-utils';
import { ComplianceRepository } from '../repositories/compliance.repository';

export interface MandateListenerDeps {
  readonly repository: ComplianceRepository;
  readonly idempotencyGuard: IdempotencyGuard;
  readonly metrics: ReturnType<typeof createServiceMetrics>;
  readonly bus: Bus;
}

export const createHandler = (deps: MandateListenerDeps) =>
  async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const failures: string[] = [];

    for (const record of event.Records) {
      try {
        const uow = parseRecord(record);
        const eventType = uow.event.type;

        logger.info('Processing mandate event', { eventType, eventId: uow.event.id });
        traceEvent(eventType, uow.event.id);

        const isNew = await deps.idempotencyGuard.ensureOnce(eventType, uow.event.id);
        if (!isNew) {
          logger.info('Duplicate event, skipping', { eventId: uow.event.id });
          continue;
        }

        const subject = uow.event.subject as Record<string, unknown>;
        const context = uow.event.context as Record<string, unknown>;
        const tenantId = (context.tenantId ?? subject.tenantId) as string;
        const userId = (subject.userId ?? tenantId) as string;

        switch (eventType) {
          case 'MANDATE_GRANTED':
          case 'MANDATE_UPDATED':
            if (!subject.mandateId || !subject.level) {
              throw new NotRetryableError(`Missing required mandate fields: mandateId=${subject.mandateId}, level=${subject.level}`);
            }
            await deps.repository.putMandateSnapshot(tenantId, userId, {
              mandateId: subject.mandateId,
              level: subject.level,
              monthlyTurnoverCapPercent: subject.monthlyTurnoverCapPercent,
              maxSingleTradePercent: subject.maxSingleTradePercent,
              effectiveDate: subject.effectiveDate,
              revokedAt: null,
            });
            logger.info('Mandate snapshot created/updated', { tenantId, userId, eventType });
            break;

          case 'MANDATE_REVOKED':
            await deps.repository.putMandateSnapshot(tenantId, userId, {
              mandateId: subject.mandateId,
              level: subject.level ?? 'ADVISORY',
              monthlyTurnoverCapPercent: subject.monthlyTurnoverCapPercent ?? 0,
              maxSingleTradePercent: subject.maxSingleTradePercent ?? 0,
              effectiveDate: subject.effectiveDate ?? new Date().toISOString(),
              revokedAt: subject.revokedAt ?? new Date().toISOString(),
            });
            logger.info('Mandate snapshot revoked', { tenantId, userId });
            break;

          case 'OPERATING_MODE_CHANGED':
            logger.info('Operating mode changed, noted', { tenantId, userId, mode: subject.mode });
            break;

          default:
            logger.info('No handler for mandate event type, skipping', { eventType });
        }
        deps.metrics.addMetric('EventProcessed', MetricUnit.Count, 1);
      } catch (error) {
        logger.error('Failed to process mandate record', {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        await publishErrorEvent(deps.bus, 'COMPLIANCE_CTRL_FAILED', error);
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
const repository = new ComplianceRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);

const mandateDeps: MandateListenerDeps = {
  repository,
  idempotencyGuard,
  metrics: createServiceMetrics('compliance-ctrl'),
  bus: new EventBridgeBus(requireEnv('BUS_NAME'), 'compliance-ctrl'),
};

export const handler = applyMiddleware(
  createHandler(mandateDeps) as (event: unknown) => Promise<SQSBatchResponse>,
  withLambdaContext(),
  withTiming('compliance-ctrl-mandate-listener'),
);
