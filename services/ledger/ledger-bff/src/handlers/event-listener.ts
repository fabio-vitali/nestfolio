import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger, type BusEvent, type Pipe, type UnitOfWork } from '@nestfolio/platform-core';
import {
  parseRecord,
  IdempotencyGuard,
  requireEnv,
  isRetryable,
  createServiceMetrics,
  MetricUnit,
  traceEvent,
  applyMiddleware,
  withLambdaContext,
  withTiming,
  publishErrorEvent,
  EventBridgeBus,
  type Bus,
} from '@nestfolio/lambda-utils';
import { PortfolioRepository } from '../repositories/portfolio.repository';
import { BalanceUpdatedPipe } from '../pipes/balance-updated.pipe';
import { PortfolioUpdatedPipe } from '../pipes/portfolio-updated.pipe';
import { LedgerEntryRecordedPipe } from '../pipes/ledger-entry-recorded.pipe';

interface NamedPipe {
  name: string;
  pipe: Pipe<UnitOfWork<BusEvent<Record<string, unknown>>>>;
}

export interface EventListenerDeps {
  readonly idempotencyGuard: IdempotencyGuard;
  readonly eventPipeMap: Record<string, NamedPipe[]>;
  readonly bus: Bus;
  readonly metrics: ReturnType<typeof createServiceMetrics>;
}

export const createHandler = (deps: EventListenerDeps) =>
  async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const failures: string[] = [];

    for (const record of event.Records) {
      try {
        const uow = parseRecord(record);
        const eventType = uow.event.type;

        logger.info('Processing event', { eventType, eventId: uow.event.id });
        traceEvent(eventType, uow.event.id);

        await processEvent(deps, eventType, uow);
        deps.metrics.addMetric('EventProcessed', MetricUnit.Count, 1);
      } catch (error) {
        logger.error('Failed to process record', {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        await publishErrorEvent(deps.bus, 'LEDGER_BFF_FAILED', error);
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
  const namedPipes = deps.eventPipeMap[eventType];

  if (!namedPipes || namedPipes.length === 0) {
    logger.info('No pipes for event type, skipping', { eventType });
    return;
  }

  for (const { name: pipeName, pipe } of namedPipes) {
    const pipeKey = `${eventType}#${uow.event.id}#${pipeName}`;
    const isNew = await deps.idempotencyGuard.ensureOnce(eventType, pipeKey);
    if (!isNew) {
      logger.info('Pipe already processed, skipping', { eventType, pipeName, eventId: uow.event.id });
      continue;
    }

    await pipe.process(uow);
  }
}

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new PortfolioRepository(TABLE_NAME, dynamoClient);

const balanceUpdatedPipe = new BalanceUpdatedPipe(repository);
const portfolioUpdatedPipe = new PortfolioUpdatedPipe(repository);
const ledgerEntryRecordedPipe = new LedgerEntryRecordedPipe(repository);

const EVENT_PIPE_MAP: Record<string, NamedPipe[]> = {
  BALANCE_UPDATED: [
    { name: 'balanceUpdated', pipe: balanceUpdatedPipe },
  ],
  PORTFOLIO_UPDATED: [
    { name: 'portfolioUpdated', pipe: portfolioUpdatedPipe },
  ],
  LEDGER_ENTRY_RECORDED: [
    { name: 'ledgerEntryRecorded', pipe: ledgerEntryRecordedPipe },
  ],
};

const deps: EventListenerDeps = {
  idempotencyGuard: new IdempotencyGuard(dynamoClient, TABLE_NAME),
  eventPipeMap: EVENT_PIPE_MAP,
  bus: new EventBridgeBus(requireEnv('BUS_NAME'), 'ledger-bff'),
  metrics: createServiceMetrics('ledger-bff'),
};

export const handler = applyMiddleware(
  createHandler(deps) as (event: unknown) => Promise<SQSBatchResponse>,
  withLambdaContext(),
  withTiming('ledger-bff-event-listener'),
);
