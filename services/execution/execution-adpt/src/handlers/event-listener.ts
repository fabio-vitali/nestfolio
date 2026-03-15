import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { parseRecord, requireEnv, extractTenantId, isRetryable, createServiceMetrics, MetricUnit, NotRetryableError, traceEvent, applyMiddleware, withLambdaContext, withTiming, publishErrorEvent, EventBridgeBus, type Bus } from '@nestfolio/lambda-utils';
import { VirtualLedgerRepository } from '../repositories/virtual-ledger.repository';
import { MarketDataService } from '../services/market-data.service';
import { SimulationEngineService } from '../services/simulation-engine.service';

interface EventListenerDeps {
  readonly repository: VirtualLedgerRepository;
  readonly simulationEngine: SimulationEngineService;
  readonly bus: Bus;
  readonly metrics: ReturnType<typeof createServiceMetrics>;
}

const HANDLED_EVENT_TYPES = new Set([
  'ORDER_SUBMITTED',
  'WITHDRAWAL_REQUESTED',
  'DEPOSIT_INITIATED',
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

        switch (eventType) {
          case 'ORDER_SUBMITTED':
            await processOrderSubmitted(deps, uow.event);
            break;
          case 'WITHDRAWAL_REQUESTED':
            await processWithdrawalRequested(deps, uow.event);
            break;
          case 'DEPOSIT_INITIATED':
            await processDepositInitiated(deps, uow.event);
            break;
        }
        deps.metrics.addMetric('EventProcessed', MetricUnit.Count, 1);
      } catch (error) {
        logger.error('Failed to process record', {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        await publishErrorEvent(deps.bus, 'EXECUTION_ADPT_FAILED', error);
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

  try {
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
  } catch (error) {
    if ((error as Error).name === 'TransactionCanceledException') {
      logger.info('Order already processed, skipping', { orderId, eventId: event.id });
      return;
    }
    throw error;
  }
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

  // Check sufficient balance before guarded write
  const cashBalance = await deps.repository.getCashBalance(tenantId, userId, 'USD');
  const balance = (cashBalance?.balance as number) ?? 0;

  if (balance < amount) {
    logger.info('Withdrawal rejected: insufficient cash', { withdrawalId, balance, amount });
    return;
  }

  // Guarded atomic debit — idempotent via event-keyed guard marker
  const processed = await deps.repository.guardedAddToCashBalance(
    tenantId, userId, 'USD', -amount, event.id as string,
  );
  if (!processed) {
    logger.info('Withdrawal already processed, skipping', { eventId: event.id });
    return;
  }

  logger.info('Withdrawal completed', { withdrawalId, amount, newBalance: balance - amount });
}

async function processDepositInitiated(
  deps: EventListenerDeps,
  event: Record<string, unknown>,
): Promise<void> {
  const subject = event.subject as Record<string, unknown>;
  if (!subject) {
    throw new NotRetryableError(`Missing subject in DEPOSIT_INITIATED event ${event.id}`);
  }
  const tenantId = extractTenantId(event);
  const userId = (subject.userId as string) ?? tenantId;
  const depositId = subject.depositId as string;
  const amountCents = subject.amountCents as number;
  const currency = (subject.currency as string) ?? 'USD';

  if (!depositId || amountCents === undefined) {
    throw new NotRetryableError(`Missing required DEPOSIT_INITIATED fields: depositId=${depositId}, amountCents=${amountCents}`);
  }

  // Convert cents to dollars for virtual ledger
  const amount = amountCents / 100;

  // Ensure simulation account exists (lazy initialization)
  const cashBalance = await deps.repository.getCashBalance(tenantId, userId, currency);
  if (!cashBalance) {
    await deps.simulationEngine.initializeAccount(tenantId, userId);
  }

  // Guarded atomic credit — idempotent via event-keyed guard marker
  const processed = await deps.repository.guardedAddToCashBalance(
    tenantId, userId, currency, amount, event.id as string,
  );
  if (!processed) {
    logger.info('Deposit already processed, skipping', { eventId: event.id });
    return;
  }

  logger.info('Deposit processed', { depositId, amount, tenantId });
}

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new VirtualLedgerRepository(TABLE_NAME, dynamoClient);
const marketData = new MarketDataService();
const simulationEngine = new SimulationEngineService(repository, marketData);

const deps: EventListenerDeps = {
  repository,
  simulationEngine,
  bus: new EventBridgeBus(requireEnv('BUS_NAME'), 'execution-adpt'),
  metrics: createServiceMetrics('execution-adpt'),
};

export const handler = applyMiddleware(
  createHandler(deps) as (event: unknown) => Promise<SQSBatchResponse>,
  withLambdaContext(),
  withTiming('execution-adpt-event-listener'),
);
