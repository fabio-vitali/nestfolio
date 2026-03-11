import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { getUUID, getTime, logger } from '@nestfolio/platform-core';
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
import { LedgerRepository } from '../repositories/ledger.repository';
import { ShadowFillService, type ProposedTrade } from '../services/shadow-fill.service';

interface EventListenerDeps {
  readonly repository: LedgerRepository;
  readonly idempotencyGuard: IdempotencyGuard;
  readonly bus: Bus;
  readonly metrics: ReturnType<typeof createServiceMetrics>;
  readonly shadowFill: ShadowFillService;
}

const ACTUAL_EVENT_TYPES = new Set([
  'ORDER_FILLED',
  'ORDER_PARTIALLY_FILLED',
  'ORDER_REJECTED',
  'ORDER_CANCELLED',
  'DEPOSIT_DETECTED',
  'WITHDRAWAL_COMPLETED',
]);

const SIMULATION_EVENT_TYPES = new Set([
  'DECISION_PACKET_CREATED',
]);

const HANDLED_EVENT_TYPES = new Set([
  ...ACTUAL_EVENT_TYPES,
  ...SIMULATION_EVENT_TYPES,
]);

function extractTenantId(event: Record<string, unknown>): string {
  const context = (event['context'] ?? {}) as Record<string, unknown>;
  const subject = (event['subject'] ?? {}) as Record<string, unknown>;
  return (context['tenantId'] as string) ?? (subject['tenantId'] as string) ?? 'unknown';
}

export const createHandler = (deps: EventListenerDeps) =>
  async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const failures: string[] = [];

    for (const record of event.Records) {
      let isSimulation = false;
      try {
        const uow = parseRecord(record);
        const eventType = uow.event.type;

        logger.info('Processing event', { eventType, eventId: uow.event.id });
        traceEvent(eventType, uow.event.id);

        if (!HANDLED_EVENT_TYPES.has(eventType)) {
          logger.warn('No handler for event type, skipping', { eventType });
          continue;
        }

        isSimulation = SIMULATION_EVENT_TYPES.has(eventType);

        if (isSimulation) {
          // Simulation events use SIM_ prefix for idempotency to avoid collisions
          const isNew = await deps.idempotencyGuard.ensureOnce('SIM_' + eventType, uow.event.id);
          if (!isNew) {
            logger.info('Duplicate simulation event, skipping', { eventId: uow.event.id });
            continue;
          }
          await processSimulationEvent(deps, uow.event);
        } else {
          const isNew = await deps.idempotencyGuard.ensureOnce(eventType, uow.event.id);
          if (!isNew) {
            logger.info('Duplicate event, skipping', { eventType, eventId: uow.event.id });
            continue;
          }
          await processActualEvent(deps, uow.event, eventType);
        }
      } catch (error) {
        logger.error('Failed to process record', {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        await publishErrorEvent(
          deps.bus,
          isSimulation ? 'ORDER_LEDGER_SIMULATION_FAILED' : 'ORDER_LEDGER_FAILED',
          error,
        );
        deps.metrics.addMetric(
          isSimulation ? 'SimulationFailed' : 'EventFailed',
          MetricUnit.Count,
          1,
        );
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

async function processActualEvent(
  deps: EventListenerDeps,
  event: Record<string, unknown>,
  eventType: string,
): Promise<void> {
  const tenantId = extractTenantId(event);
  const subject = (event.subject ?? {}) as Record<string, unknown>;
  const orderId = (subject['orderId'] as string) ?? (event.id as string);

  const sequenceNo = await deps.repository.nextSequence(tenantId, 'actual', orderId);

  await deps.repository.putLedgerEntry({
    tenantId,
    streamType: 'actual',
    orderId,
    eventId: event.id as string,
    eventType,
    payload: subject,
    timestamp: event.timestamp as string,
    sequenceNo,
    decisionId: subject['decisionId'] as string | undefined,
  });

  deps.metrics.addMetric('EventProcessed', MetricUnit.Count, 1);
}

async function processSimulationEvent(
  deps: EventListenerDeps,
  event: Record<string, unknown>,
): Promise<void> {
  const tenantId = extractTenantId(event);
  const subject = (event.subject ?? {}) as Record<string, unknown>;
  const decisionPacketId = (subject['decisionPacketId'] as string) ?? (event.id as string);
  const proposedTrades = (subject['proposedTrades'] ?? []) as ProposedTrade[];

  if (proposedTrades.length === 0) {
    logger.info('No proposed trades in decision packet, skipping', { decisionPacketId });
    return;
  }

  const now = getTime();

  for (const trade of proposedTrades) {
    const fillResult = await deps.shadowFill.simulateFill(trade);
    const orderId = `sim-${decisionPacketId}-${trade.symbol}`;
    const sequenceNo = await deps.repository.nextSequence(tenantId, 'simulated', orderId);

    await deps.repository.putLedgerEntry({
      tenantId,
      streamType: 'simulated',
      orderId,
      eventId: getUUID(),
      eventType: 'ORDER_FILLED',
      payload: {
        orderId,
        symbol: trade.symbol,
        side: trade.side,
        quantity: trade.quantity,
        fillPrice: fillResult.price,
        filledAt: now,
      },
      timestamp: now,
      sequenceNo,
      decisionId: decisionPacketId,
    });
  }

  deps.metrics.addMetric('SimulationProcessed', MetricUnit.Count, 1);
}

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new LedgerRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);

const deps: EventListenerDeps = {
  repository,
  idempotencyGuard,
  bus: new EventBridgeBus(requireEnv('BUS_NAME'), 'order-ledger'),
  metrics: createServiceMetrics('order-ledger'),
  shadowFill: new ShadowFillService(),
};

export const handler = applyMiddleware(
  createHandler(deps) as (event: unknown) => Promise<SQSBatchResponse>,
  withLambdaContext(),
  withTiming('order-ledger-event-listener'),
);
