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

interface SimulationListenerDeps {
  readonly repository: LedgerRepository;
  readonly idempotencyGuard: IdempotencyGuard;
  readonly bus: Bus;
  readonly metrics: ReturnType<typeof createServiceMetrics>;
  readonly shadowFill: ShadowFillService;
}

function extractTenantId(event: Record<string, unknown>): string {
  const context = (event['context'] ?? {}) as Record<string, unknown>;
  const subject = (event['subject'] ?? {}) as Record<string, unknown>;
  return (context['tenantId'] as string) ?? (subject['tenantId'] as string) ?? 'unknown';
}

export const createHandler = (deps: SimulationListenerDeps) =>
  async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const failures: string[] = [];

    for (const record of event.Records) {
      try {
        const uow = parseRecord(record);
        const eventType = uow.event.type;

        logger.info('Processing simulation event', { eventType, eventId: uow.event.id });
        traceEvent(eventType, uow.event.id);

        if (eventType !== 'DECISION_PACKET_CREATED') {
          logger.warn('Unexpected event type for simulation listener, skipping', { eventType });
          continue;
        }

        const isNew = await deps.idempotencyGuard.ensureOnce('SIM_' + eventType, uow.event.id);
        if (!isNew) {
          logger.info('Duplicate simulation event, skipping', { eventId: uow.event.id });
          continue;
        }

        const tenantId = extractTenantId(uow.event);
        const subject = (uow.event.subject ?? {}) as Record<string, unknown>;
        const decisionPacketId = (subject['decisionPacketId'] as string) ?? uow.event.id;
        const proposedTrades = (subject['proposedTrades'] ?? []) as ProposedTrade[];

        if (proposedTrades.length === 0) {
          logger.info('No proposed trades in decision packet, skipping', { decisionPacketId });
          continue;
        }

        const now = getTime();

        for (const trade of proposedTrades) {
          const fillResult = deps.shadowFill.simulateFill(trade);
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
      } catch (error) {
        logger.error('Failed to process simulation record', {
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        await publishErrorEvent(deps.bus, 'ORDER_LEDGER_SIMULATION_FAILED', error);
        deps.metrics.addMetric('SimulationFailed', MetricUnit.Count, 1);
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

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new LedgerRepository(TABLE_NAME, dynamoClient);
const idempotencyGuard = new IdempotencyGuard(dynamoClient, TABLE_NAME);

const deps: SimulationListenerDeps = {
  repository,
  idempotencyGuard,
  bus: new EventBridgeBus(requireEnv('BUS_NAME'), 'order-ledger'),
  metrics: createServiceMetrics('order-ledger'),
  shadowFill: new ShadowFillService(),
};

export const handler = applyMiddleware(
  createHandler(deps) as (event: unknown) => Promise<SQSBatchResponse>,
  withLambdaContext(),
  withTiming('order-ledger-simulation-listener'),
);
