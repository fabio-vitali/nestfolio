import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/event-processor';
import { getTime, logger } from '@nestfolio/event-processor';
import { LedgerRepository } from '../repositories/ledger.repository';
import { ShadowFillService, type ProposedTrade } from '../services/shadow-fill.service';

export interface EventListenerDeps {
  readonly repository: LedgerRepository;
  readonly shadowFill: ShadowFillService;
}

async function processActualEvent(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
) {
  const tenantId = ctx.tenantId;
  const subject = payload.subject ?? {};
  const context = payload.context ?? {};
  const eventPayload = { ...subject, userId: subject['userId'] ?? context['userId'] };

  const sequenceNo = await deps.repository.nextSequence(tenantId, 'actual');

  const created = await deps.repository.putLedgerEntry({
    tenantId,
    streamType: 'actual',
    eventId: ctx.eventId,
    eventType: ctx.eventType,
    payload: eventPayload,
    timestamp: ctx.timestamp,
    sequenceNo,
    decisionId: subject['decisionId'] as string | undefined,
  });

  if (!created) {
    logger.info('Duplicate ledger entry, skipping', { eventType: ctx.eventType, eventId: ctx.eventId });
  }

  return skip();
}

async function processSimulationEvent(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
) {
  const tenantId = ctx.tenantId;
  const subject = payload.subject ?? {};
  const decisionPacketId = (subject['decisionPacketId'] as string) ?? ctx.eventId;
  const proposedTrades = (subject['proposedTrades'] ?? []) as ProposedTrade[];

  if (proposedTrades.length === 0) {
    logger.info('No proposed trades in decision packet, skipping', { decisionPacketId });
    return skip();
  }

  const now = getTime();

  for (const trade of proposedTrades) {
    const fillResult = await deps.shadowFill.simulateFill(trade);
    const sequenceNo = await deps.repository.nextSequence(tenantId, 'simulated');

    const created = await deps.repository.putLedgerEntry({
      tenantId,
      streamType: 'simulated',
      eventId: `${ctx.eventId}-sim-${trade.symbol}`,
      eventType: 'ORDER_FILLED',
      payload: {
        orderId: `sim-${decisionPacketId}-${trade.symbol}`,
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

    if (!created) {
      logger.info('Duplicate simulation entry, skipping', { symbol: trade.symbol, eventId: ctx.eventId });
      continue;
    }
  }

  return skip();
}

const ACTUAL_EVENT_TYPES = [
  'ORDER_FILLED',
  'ORDER_PARTIALLY_FILLED',
  'ORDER_REJECTED',
  'ORDER_CANCELLED',
  'DEPOSIT_DETECTED',
  'WITHDRAWAL_COMPLETED',
  'CORPORATE_ACTION_PROCESSED',
] as const;

const SIMULATION_EVENT_TYPES = [
  'DECISION_PACKET_CREATED',
] as const;

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<ReturnType<typeof skip>>> = {};

  for (const type of ACTUAL_EVENT_TYPES) {
    handlers[type] = (payload, ctx) => processActualEvent(deps, payload, ctx);
  }

  for (const type of SIMULATION_EVENT_TYPES) {
    handlers[type] = (payload, ctx) => processSimulationEvent(deps, payload, ctx);
  }

  return handlers;
};

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new LedgerRepository(TABLE_NAME, dynamoClient);

const deps: EventListenerDeps = {
  repository,
  shadowFill: new ShadowFillService(),
};

export const handler = createEventHandler({
  serviceName: 'ledger-ctrl',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'LEDGER_PROCESSING_FAILED',
});
