import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard, requireEnv, extractTenantId, isRetryable, createServiceMetrics, MetricUnit, NotRetryableError, traceEvent, applyMiddleware, withLambdaContext, withTiming } from '@nestfolio/lambda-utils';
import { VirtualLedgerRepository } from '../repositories/virtual-ledger.repository';
import { MarketDataService } from '../services/market-data.service';
import { SimulationEngineService } from '../services/simulation-engine.service';

interface EventListenerDeps {
  readonly repository: VirtualLedgerRepository;
  readonly idempotencyGuard: IdempotencyGuard;
  readonly simulationEngine: SimulationEngineService;
  readonly metrics: ReturnType<typeof createServiceMetrics>;
}

const HANDLED_EVENT_TYPES = new Set([
  'ORDER_SUBMITTED',
  'WITHDRAWAL_REQUESTED',
]);

export const createHandler = (deps: EventListenerDeps) =>
  async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const failures: string[] = [];

    for (const record of event.Records) {
      try {
        const uow = parseRecord(record);
        const eventType = uow.event.type;

        logger.info('Processing event', { eventType, eventId: uow.event.id });
        traceEvent(eventType, uow.event.id);

        if (!HANDLED_EVENT_TYPES.has(eventType)) {
          logger.warn('No handler for event type, skipping', { eventType });
          continue;
        }

        const isNew = await deps.idempotencyGuard.ensureOnce(eventType, uow.event.id);
        if (!isNew) {
          logger.info('Duplicate event, skipping', { eventId: uow.event.id });
          continue;
        }

        switch (eventType) {
          case 'ORDER_SUBMITTED':
            await processOrderSubmitted(deps, uow.event);
            break;
          case 'WITHDRAWAL_REQUESTED':
            await processWithdrawalRequested(deps, uow.event);
            break;
        }
        deps.metrics.addMetric('EventProcessed', MetricUnit.Count, 1);
      } catch (error) {
        logger.error('Failed to process record', {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
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

async function processOrderSubmitted(
  deps: EventListenerDeps,
  event: Record<string, unknown>,
): Promise<void> {
  const subject = event.subject as Record<string, unknown>;
  if (!subject) {
    throw new NotRetryableError(`Missing subject in ORDER_SUBMITTED event ${event.id}`);
  }
  const tenantId = extractTenantId(event);
  const userId = (subject.userId as string) ?? tenantId;
  const orderId = subject.orderId as string;
  const symbol = subject.symbol as string;
  const side = subject.side as 'BUY' | 'SELL';
  const quantity = subject.quantity as number;

  if (!orderId || !symbol || !side || quantity === undefined) {
    throw new NotRetryableError(`Missing required ORDER_SUBMITTED fields: orderId=${orderId}, symbol=${symbol}, side=${side}, quantity=${quantity}`);
  }

  // Ensure simulation account exists (lazy initialization)
  const cashBalance = await deps.repository.getCashBalance(tenantId, userId, 'USD');
  if (!cashBalance) {
    await deps.simulationEngine.initializeAccount(tenantId, userId);
  }

  const result = await deps.simulationEngine.processOrderSubmitted(
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
  deps: EventListenerDeps,
  event: Record<string, unknown>,
): Promise<void> {
  const subject = event.subject as Record<string, unknown>;
  if (!subject) {
    throw new NotRetryableError(`Missing subject in WITHDRAWAL_REQUESTED event ${event.id}`);
  }
  const tenantId = extractTenantId(event);
  const userId = (subject.userId as string) ?? tenantId;
  const withdrawalId = subject.withdrawalId as string;
  const amount = subject.amount as number;

  if (!withdrawalId || amount === undefined) {
    throw new NotRetryableError(`Missing required WITHDRAWAL_REQUESTED fields: withdrawalId=${withdrawalId}, amount=${amount}`);
  }

  const result = await deps.simulationEngine.processWithdrawal(
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

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new VirtualLedgerRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);
const marketData = new MarketDataService();
const simulationEngine = new SimulationEngineService(repository, marketData);

const deps: EventListenerDeps = {
  repository,
  idempotencyGuard,
  simulationEngine,
  metrics: createServiceMetrics('execution-adpt'),
};

export const handler = applyMiddleware(
  createHandler(deps) as (event: unknown) => Promise<SQSBatchResponse>,
  withLambdaContext(),
  withTiming('execution-adpt-event-listener'),
);
