import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger, type BusEvent, type UnitOfWork } from '@nestfolio/platform-core';
import { parseRecord, requireEnv, isRetryable, createServiceMetrics, MetricUnit, traceEvent, applyMiddleware, withLambdaContext, withTiming, publishErrorEvent, EventBridgeBus, type Bus } from '@nestfolio/lambda-utils';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';
import { UserRegisteredPipe } from '../pipes/user-registered.pipe';
import { NotificationCreatedPipe } from '../pipes/notification-created.pipe';
import { BalanceUpdatedPipe } from '../pipes/balance-updated.pipe';

interface EventListenerDeps {
  readonly repository: InvestorProfileRepository;
  readonly userRegisteredPipe: UserRegisteredPipe;
  readonly notificationCreatedPipe: NotificationCreatedPipe;
  readonly balanceUpdatedPipe: BalanceUpdatedPipe;
  readonly bus: Bus;
  readonly metrics: ReturnType<typeof createServiceMetrics>;
}

const TRIGGER_EVENT_TYPES = new Set([
  'USER_REGISTERED',
  'NOTIFICATION_CREATED',
  'BALANCE_UPDATED',
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
    case 'BALANCE_UPDATED':
      await deps.balanceUpdatedPipe.process(uow as any);
      break;
  }
}

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new InvestorProfileRepository(TABLE_NAME, dynamoClient);

const deps: EventListenerDeps = {
  repository,
  userRegisteredPipe: new UserRegisteredPipe(repository),
  notificationCreatedPipe: new NotificationCreatedPipe(repository),
  balanceUpdatedPipe: new BalanceUpdatedPipe(repository),
  bus: new EventBridgeBus(requireEnv('BUS_NAME'), 'investor-bff'),
  metrics: createServiceMetrics('investor-bff'),
};

export const handler = applyMiddleware(
  createHandler(deps) as (event: unknown) => Promise<SQSBatchResponse>,
  withLambdaContext(),
  withTiming('investor-bff-event-listener'),
);
