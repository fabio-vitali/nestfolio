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

      logger.info('Processing compliance callback', { eventType, eventId: uow.event.id });

      const isNew = await idempotencyGuard.ensureOnce(eventType, uow.event.id);
      if (!isNew) {
        logger.info('Duplicate event, skipping', { eventType, eventId: uow.event.id });
        continue;
      }

      const subject = uow.event.subject as Record<string, unknown>;
      const tenantId = subject?.tenantId as string ?? 'unknown';
      const dpId = subject?.decisionId as string;
      const authorityLevel = subject?.authorityLevel as string ?? 'L2';

      if (eventType === 'DECISION_APPROVED') {
        if (authorityLevel === 'L1') {
          // L1: Autonomous — update status to APPROVED, ready for execution
          await repository.updateDecisionStatus(tenantId, dpId, 'APPROVED', {
            authorityLevel,
            approvedAt: new Date().toISOString(),
          });
          logger.info('Decision approved (L1 autonomous)', { dpId, tenantId });
        } else {
          // L2: Needs user confirmation
          await repository.updateDecisionStatus(tenantId, dpId, 'AWAITING_CONFIRMATION', {
            authorityLevel,
            confirmationRequired: true,
          });
          logger.info('Decision requires user confirmation (L2)', { dpId, tenantId });
        }
      } else if (eventType === 'DECISION_BLOCKED') {
        await repository.updateDecisionStatus(tenantId, dpId, 'BLOCKED', {
          blockedAt: new Date().toISOString(),
          blockReason: subject?.reason as string ?? 'Compliance check failed',
        });
        logger.info('Decision blocked', { dpId, tenantId });
      } else {
        logger.info('Unhandled compliance event type, skipping', { eventType });
      }
    } catch (error) {
      logger.error('Failed to process compliance callback', {
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
