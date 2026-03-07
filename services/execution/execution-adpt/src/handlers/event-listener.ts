import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard } from '@nestfolio/lambda-utils';
import { VirtualLedgerRepository } from '../repositories/virtual-ledger.repository';
import { MarketDataService } from '../services/market-data.service';
import { SimulationEngineService } from '../services/simulation-engine.service';

const TABLE_NAME = process.env.TABLE_NAME!;
const dynamoClient = new DynamoDBClient({});
const repository = new VirtualLedgerRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);
const marketData = new MarketDataService();
const simulationEngine = new SimulationEngineService(repository, marketData);

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

      if (eventType === 'ORDER_SUBMITTED') {
        await processOrderSubmitted(uow.event);
      } else if (eventType === 'WITHDRAWAL_REQUESTED') {
        await processWithdrawalRequested(uow.event);
      } else {
        logger.info('No handler for event type, skipping', { eventType });
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

async function processOrderSubmitted(
  event: Record<string, unknown>,
): Promise<void> {
  const subject = event.subject as Record<string, unknown>;
  const context = event.context as Record<string, unknown>;
  const tenantId = (context.tenantId ?? subject.tenantId) as string;
  const userId = (subject.userId ?? tenantId) as string;
  const orderId = subject.orderId as string;
  const symbol = subject.symbol as string;
  const side = subject.side as 'BUY' | 'SELL';
  const quantity = subject.quantity as number;

  // Ensure simulation account exists (lazy initialization)
  const cashBalance = await repository.getCashBalance(tenantId, userId, 'USD');
  if (!cashBalance) {
    await simulationEngine.initializeAccount(tenantId, userId);
  }

  const result = await simulationEngine.processOrderSubmitted(
    tenantId,
    userId,
    orderId,
    symbol,
    side,
    quantity,
  );

  logger.info('Order simulation complete', {
    orderId,
    status: result.status,
    fillPrice: result.fillPrice,
    rejectReason: result.rejectReason,
  });
}

async function processWithdrawalRequested(
  event: Record<string, unknown>,
): Promise<void> {
  const subject = event.subject as Record<string, unknown>;
  const context = event.context as Record<string, unknown>;
  const tenantId = (context.tenantId ?? subject.tenantId) as string;
  const userId = (subject.userId ?? tenantId) as string;
  const withdrawalId = subject.withdrawalId as string;
  const amount = subject.amount as number;

  const result = await simulationEngine.processWithdrawal(
    tenantId,
    userId,
    withdrawalId,
    amount,
  );

  logger.info('Withdrawal simulation complete', {
    withdrawalId,
    status: result.status,
    reason: result.reason,
  });
}
