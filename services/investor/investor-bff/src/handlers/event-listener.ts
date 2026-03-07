import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import Highland from 'highland';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger, type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard } from '@nestfolio/lambda-utils';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';
import { UserRegisteredPipe } from '../pipes/user-registered.pipe';
import { NotificationCreatedPipe } from '../pipes/notification-created.pipe';
import { DepositDetectedPipe } from '../pipes/deposit-detected.pipe';
import { WithdrawalCompletedPipe } from '../pipes/withdrawal-completed.pipe';

const TABLE_NAME = process.env.TABLE_NAME!;
const dynamoClient = new DynamoDBClient({});
const repository = new InvestorProfileRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);

const userRegisteredPipe = new UserRegisteredPipe(repository, idempotencyGuard);
const notificationCreatedPipe = new NotificationCreatedPipe(repository);
const depositDetectedPipe = new DepositDetectedPipe(repository);
const withdrawalCompletedPipe = new WithdrawalCompletedPipe(repository);

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: string[] = [];

  for (const record of event.Records) {
    try {
      const uow = parseRecord(record);
      const eventType = uow.event.type;

      logger.info('Processing event', { eventType, eventId: uow.event.id });

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
      case 'USER_REGISTERED':
        pipe = userRegisteredPipe;
        break;
      case 'NOTIFICATION_CREATED':
        pipe = notificationCreatedPipe;
        break;
      case 'DEPOSIT_DETECTED':
        pipe = depositDetectedPipe;
        break;
      case 'WITHDRAWAL_COMPLETED':
        pipe = withdrawalCompletedPipe;
        break;
      default:
        logger.info('No pipe for event type, skipping', { eventType });
        resolve();
        return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pipe as any).feed(source).done(() => resolve());

    source.on('error', (err: Error) => reject(err));
  });
}
