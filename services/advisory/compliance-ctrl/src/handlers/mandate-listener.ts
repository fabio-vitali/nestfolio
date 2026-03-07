import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard } from '@nestfolio/lambda-utils';
import { ComplianceRepository } from '../repositories/compliance.repository';

const TABLE_NAME = process.env.TABLE_NAME!;
const dynamoClient = new DynamoDBClient({});
const repository = new ComplianceRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: string[] = [];

  for (const record of event.Records) {
    try {
      const uow = parseRecord(record);
      const eventType = uow.event.type;

      logger.info('Processing mandate event', { eventType, eventId: uow.event.id });

      const isNew = await idempotencyGuard.ensureOnce(eventType, uow.event.id);
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
          await repository.putMandateSnapshot(tenantId, userId, {
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
          await repository.putMandateSnapshot(tenantId, userId, {
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
    } catch (error) {
      logger.error('Failed to process mandate record', {
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
