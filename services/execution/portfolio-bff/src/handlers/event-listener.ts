import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import Highland from 'highland';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger, type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard, requireEnv } from '@nestfolio/lambda-utils';
import { PortfolioRepository } from '../repositories/portfolio.repository';
import { OrderFilledPipe } from '../pipes/order-filled.pipe';
import { SnapshotImportedPipe } from '../pipes/snapshot-imported.pipe';

const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new PortfolioRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);

const orderFilledPipe = new OrderFilledPipe(repository);
const snapshotImportedPipe = new SnapshotImportedPipe(repository);

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: string[] = [];

  for (const record of event.Records) {
    try {
      const uow = parseRecord(record);
      const eventType = uow.event.type;

      logger.info('Processing event', { eventType, eventId: uow.event.id });

      const isNew = await idempotencyGuard.ensureOnce(eventType, uow.event.id);
      if (!isNew) {
        logger.info('Duplicate event, skipping', { eventType, eventId: uow.event.id });
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
  switch (eventType) {
    case 'ORDER_FILLED':
    case 'ORDER_PARTIALLY_FILLED':
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return runPipe(orderFilledPipe as any, uow);

    case 'PORTFOLIO_SNAPSHOT_IMPORTED':
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return runPipe(snapshotImportedPipe as any, uow);

    case 'CORPORATE_ACTION_APPLIED':
      await handleCorporateAction(uow);
      return;

    default:
      logger.info('No handler for event type, skipping', { eventType });
  }
}

function runPipe(
  pipe: { feed: (source: Highland.Stream<UnitOfWork<BusEvent<Record<string, unknown>>>>) => Highland.Stream<void> },
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const source = Highland<UnitOfWork<BusEvent<Record<string, unknown>>>>([uow]);

    const output = pipe.feed(source);
    output.errors((err: Error) => reject(err)).done(() => resolve());
  });
}

async function handleCorporateAction(
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): Promise<void> {
  const payload = uow.event.subject as Record<string, unknown>;
  const tenantId = (payload.tenantId as string) ?? 'unknown';
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
