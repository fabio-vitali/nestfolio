import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger, type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard, requireEnv, extractTenantId, isRetryable, createServiceMetrics, MetricUnit, traceEvent } from '@nestfolio/lambda-utils';
import { PortfolioRepository } from '../repositories/portfolio.repository';
import { OrderFilledPipe } from '../pipes/order-filled.pipe';
import { SnapshotImportedPipe } from '../pipes/snapshot-imported.pipe';

const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new PortfolioRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);

const orderFilledPipe = new OrderFilledPipe(repository);
const snapshotImportedPipe = new SnapshotImportedPipe(repository);
const metrics = createServiceMetrics('portfolio-bff');

const TRIGGER_EVENT_TYPES = new Set([
  'ORDER_FILLED',
  'ORDER_PARTIALLY_FILLED',
  'PORTFOLIO_SNAPSHOT_IMPORTED',
  'CORPORATE_ACTION_APPLIED',
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
        logger.info('Duplicate event, skipping', { eventType, eventId: uow.event.id });
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
    case 'ORDER_FILLED':
    case 'ORDER_PARTIALLY_FILLED':
      await orderFilledPipe.process(uow as any);
      break;

    case 'PORTFOLIO_SNAPSHOT_IMPORTED':
      await snapshotImportedPipe.process(uow as any);
      break;

    case 'CORPORATE_ACTION_APPLIED':
      await handleCorporateAction(uow);
      break;
  }
}

async function handleCorporateAction(
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): Promise<void> {
  const payload = uow.event.subject as Record<string, unknown>;
  const tenantId = extractTenantId(uow.event as unknown as Record<string, unknown>);
  const portfolioId = (payload.portfolioId as string) ?? tenantId;
  const actionType = payload.actionType as string;
  const symbol = payload.symbol as string;

  if (actionType === 'SPLIT') {
    const ratio = (payload.ratio as number) ?? 1;
    const existing = await repository.getPosition(tenantId, portfolioId, symbol);
    if (existing) {
      const currentQty = existing.quantity as number;
      const currentAvgCost = existing.avgCostBasis as number;
      await repository.upsertPosition(
        tenantId,
        portfolioId,
        symbol,
        currentQty * ratio,
        currentAvgCost / ratio,
        (existing.currentPrice as number) / ratio,
      );
    }
  }

  logger.info('Processed corporate action', { tenantId, actionType, symbol });
}
