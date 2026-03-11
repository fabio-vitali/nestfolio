import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger, type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { parseRecord, IdempotencyGuard, requireEnv, isRetryable, createServiceMetrics, MetricUnit, traceEvent, applyMiddleware, withLambdaContext, withTiming, publishErrorEvent, EventBridgeBus, type Bus } from '@nestfolio/lambda-utils';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';
import { UserRegisteredPipe } from '../pipes/user-registered.pipe';
import { NotificationCreatedPipe } from '../pipes/notification-created.pipe';
import { DepositDetectedPipe } from '../pipes/deposit-detected.pipe';
import { WithdrawalCompletedPipe } from '../pipes/withdrawal-completed.pipe';

interface EventListenerDeps {
  readonly repository: InvestorProfileRepository;
  readonly idempotencyGuard: IdempotencyGuard;
  readonly userRegisteredPipe: UserRegisteredPipe;
  readonly notificationCreatedPipe: NotificationCreatedPipe;
  readonly depositDetectedPipe: DepositDetectedPipe;
  readonly withdrawalCompletedPipe: WithdrawalCompletedPipe;
  readonly bus: Bus;
  readonly metrics: ReturnType<typeof createServiceMetrics>;
}

const TRIGGER_EVENT_TYPES = new Set([
  'USER_REGISTERED',
  'NOTIFICATION_CREATED',
  'DEPOSIT_DETECTED',
  'WITHDRAWAL_COMPLETED',
  'ORDER_FILLED',
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

        if (!TRIGGER_EVENT_TYPES.has(eventType)) {
          logger.warn('No handler for event type, skipping', { eventType });
          continue;
        }

        const isNew = await deps.idempotencyGuard.ensureOnce(eventType, uow.event.id);
        if (!isNew) {
          logger.info('Duplicate event, skipping', { eventId: uow.event.id });
          continue;
        }

        await processEvent(deps, eventType, uow);
        deps.metrics.addMetric('EventProcessed', MetricUnit.Count, 1);
      } catch (error) {
        logger.error('Failed to process record', {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        await publishErrorEvent(deps.bus, 'INVESTOR_BFF_FAILED', error);
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

async function processEvent(
  deps: EventListenerDeps,
  eventType: string,
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): Promise<void> {
  switch (eventType) {
    case 'USER_REGISTERED':
      await deps.userRegisteredPipe.process(uow as any);
      break;
    case 'NOTIFICATION_CREATED':
      await deps.notificationCreatedPipe.process(uow as any);
      break;
    case 'DEPOSIT_DETECTED':
      await deps.depositDetectedPipe.process(uow as any);
      break;
    case 'WITHDRAWAL_COMPLETED':
      await deps.withdrawalCompletedPipe.process(uow as any);
      break;
    case 'ORDER_FILLED':
      await updateCashBalanceFromFill(deps, uow);
      break;
  }
}

async function updateCashBalanceFromFill(
  deps: EventListenerDeps,
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): Promise<void> {
  const payload = uow.event.subject as Record<string, unknown>;
  const tenantId = (payload?.tenantId as string) ?? (uow.event.context as Record<string, unknown>)?.tenantId as string;
  const userId = payload?.userId as string;
  const side = payload?.side as string;
  const totalValue = payload?.totalValue as number;

  if (!tenantId || !userId || !side || totalValue == null) {
    logger.warn('ORDER_FILLED event missing required fields for cash update', { tenantId, userId, side, totalValue });
    return;
  }

  // BUY decreases cash, SELL increases cash
  const deltaCents = side === 'BUY' ? -Math.round(totalValue * 100) : Math.round(totalValue * 100);
  await deps.repository.updateCashBalance(tenantId, userId, deltaCents);
}

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new InvestorProfileRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);

const deps: EventListenerDeps = {
  repository,
  idempotencyGuard,
  userRegisteredPipe: new UserRegisteredPipe(repository, idempotencyGuard),
  notificationCreatedPipe: new NotificationCreatedPipe(repository),
  depositDetectedPipe: new DepositDetectedPipe(repository),
  withdrawalCompletedPipe: new WithdrawalCompletedPipe(repository),
  bus: new EventBridgeBus(requireEnv('BUS_NAME'), 'investor-bff'),
  metrics: createServiceMetrics('investor-bff'),
};

export const handler = applyMiddleware(
  createHandler(deps) as (event: unknown) => Promise<SQSBatchResponse>,
  withLambdaContext(),
  withTiming('investor-bff-event-listener'),
);
