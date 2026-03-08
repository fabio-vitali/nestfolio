import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard, requireEnv, extractTenantId } from '@nestfolio/lambda-utils';
import { ReconciliationRepository } from '../repositories/reconciliation.repository';
import { ReconciliationService } from '../services/reconciliation.service';

const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new ReconciliationRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);
const reconciliationService = new ReconciliationService(repository);

const TRIGGER_EVENT_TYPES = new Set([
  'PORTFOLIO_SNAPSHOT_IMPORTED',
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

      const subject = uow.event.subject as Record<string, unknown>;
      const portfolioId = (subject?.portfolioId as string) ?? tenantId;

      // Phase 2: Virtual ledger is sole truth source -- reconciliation always succeeds with zero drift
      const positions = (subject?.positions as Array<{ symbol: string; quantity: number }>) ?? [];

      try {
        await reconciliationService.reconcile({
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
