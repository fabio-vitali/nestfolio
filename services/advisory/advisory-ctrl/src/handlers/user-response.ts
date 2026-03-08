import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard, requireEnv } from '@nestfolio/lambda-utils';
import { DecisionRepository } from '../repositories/decision.repository';

const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new DecisionRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: string[] = [];

  for (const record of event.Records) {
    try {
      const uow = parseRecord(record);
      const eventType = uow.event.type;

      logger.info('Processing user response', { eventType, eventId: uow.event.id });

      const isNew = await idempotencyGuard.ensureOnce(eventType, uow.event.id);
      if (!isNew) {
        logger.info('Duplicate event, skipping', { eventType, eventId: uow.event.id });
        continue;
      }

      const subject = uow.event.subject as Record<string, unknown>;
      const tenantId = subject?.tenantId as string ?? 'unknown';
      const dpId = subject?.decisionId as string;

      if (eventType === 'USER_CONFIRMED') {
        if (!dpId) {
          throw new Error('Missing decisionId in user response event subject');
        }
        await repository.updateDecisionStatus(tenantId, dpId, 'CONFIRMED', {
          confirmedAt: new Date().toISOString(),
        });
        logger.info('Decision confirmed by user', { dpId, tenantId });
      } else if (eventType === 'USER_REJECTED') {
        if (!dpId) {
          throw new Error('Missing decisionId in user response event subject');
        }
        const reason = subject?.reason as string ?? 'User rejected decision';
        await repository.updateDecisionStatus(tenantId, dpId, 'REJECTED', {
          rejectedAt: new Date().toISOString(),
          rejectionReason: reason,
        });
        logger.info('Decision rejected by user', { dpId, tenantId, reason });
      } else {
        logger.info('Unhandled user response event type, skipping', { eventType });
      }
    } catch (error) {
      logger.error('Failed to process user response', {
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
