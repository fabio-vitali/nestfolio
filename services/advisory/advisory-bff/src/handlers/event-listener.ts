import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import Highland from 'highland';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger, type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard, requireEnv } from '@nestfolio/lambda-utils';
import { AdvisoryRepository } from '../repositories/advisory.repository';
import { DecisionPacketCreatedPipe } from '../pipes/decision-packet-created.pipe';
import { DecisionStatusChangedPipe } from '../pipes/decision-status-changed.pipe';

const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new AdvisoryRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);

const decisionPacketCreatedPipe = new DecisionPacketCreatedPipe(repository, idempotencyGuard);
const decisionStatusChangedPipe = new DecisionStatusChangedPipe(repository);

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: string[] = [];

  for (const record of event.Records) {
    try {
      const uow = parseRecord(record);
      const eventType = uow.event.type;

      logger.info('Processing event', { eventType, eventId: uow.event.id });

      const isNew = await idempotencyGuard.ensureOnce(eventType, uow.event.id);
      if (!isNew) {
        logger.info('Duplicate event, skipping', { eventId: uow.event.id });
        continue;
      }

      await processEvent(eventType, uow);
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

async function processEvent(
  eventType: string,
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const source = Highland<UnitOfWork<BusEvent<Record<string, unknown>>>>([uow]);

    let pipe;
    switch (eventType) {
      case 'DECISION_PACKET_CREATED':
        pipe = decisionPacketCreatedPipe;
        break;
      case 'DECISION_PACKET_ENRICHED':
      case 'DECISION_APPROVED':
      case 'DECISION_BLOCKED':
      case 'USER_CONFIRMATION_REQUESTED':
        pipe = decisionStatusChangedPipe;
        break;
      default:
        logger.info('No pipe for event type, skipping', { eventType });
        resolve();
        return;
    }

    source.on('error', (err: Error) => reject(err));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pipe as any).feed(source).done(() => resolve());
  });
}
