import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createIngestionHandler, skip, pickRequestContext, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/event-processor';
import { getTime, logger } from '@nestfolio/event-processor';
import { ExecutionCrossDomainEventTypes } from '@nestfolio/execution-adpt/domain';
import { AdvisoryCrossDomainEventTypes } from '@nestfolio/advisory-adpt/domain';
import { LedgerRepository } from '../repositories/ledger.repository';
import { ShadowFillService, type ProposedTrade } from '../services/shadow-fill.service';
import { TaxLotManager } from '../services/tax-lot-manager';

export interface EventListenerDeps {
  readonly repository: LedgerRepository;
  readonly shadowFill: ShadowFillService;
  readonly taxLotManager: TaxLotManager;
}

async function processActualEvent(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
) {
  const subject = payload.subject ?? {};
  const context = payload.context ?? {};
  const eventPayload: Record<string, unknown> = { ...subject, userId: subject['userId'] ?? context['userId'] };

  const sequenceNo = await deps.repository.nextSequence(ctx.tenantId, 'actual');

  const created = await deps.repository.putLedgerEntry({
    streamType: 'actual',
    eventId: ctx.eventId,
    eventType: ctx.eventType,
    payload: eventPayload,
    timestamp: ctx.timestamp,
    sequenceNo,
    decisionId: subject['decisionId'] as string | undefined,
  }, pickRequestContext(ctx));

  if (!created) {
    logger.info('Duplicate ledger entry, skipping', { eventType: ctx.eventType, eventId: ctx.eventId });
  }

  // Tax lot tracking for live fills
  if (ctx.eventType === 'ORDER_FILLED' && eventPayload.executionMode === 'live') {
    const side = eventPayload.side as string;
    if (side === 'BUY') {
      await deps.taxLotManager.openLot({
        tenantId: ctx.tenantId,
        orderId: eventPayload.orderId as string,
        symbol: eventPayload.symbol as string,
        quantity: eventPayload.filledQuantity as number ?? eventPayload.quantity as number,
        costBasisPerShare: eventPayload.averageFillPrice as number ?? eventPayload.fillPrice as number,
        acquiredAt: ctx.timestamp,
      });
    } else if (side === 'SELL') {
      await deps.taxLotManager.closeLots({
        tenantId: ctx.tenantId,
        symbol: eventPayload.symbol as string,
        quantity: eventPayload.filledQuantity as number ?? eventPayload.quantity as number,
        salePrice: eventPayload.averageFillPrice as number ?? eventPayload.fillPrice as number,
        soldAt: ctx.timestamp,
        orderId: eventPayload.orderId as string,
      });
    }
  }

  return skip();
}

async function processSimulationEvent(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
) {
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
    const sequenceNo = await deps.repository.nextSequence(ctx.tenantId, 'simulated');

    const created = await deps.repository.putLedgerEntry({
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
    }, pickRequestContext(ctx));

    if (!created) {
      logger.info('Duplicate simulation entry, skipping', { symbol: trade.symbol, eventId: ctx.eventId });
      continue;
    }
  }

  return skip();
}

const ACTUAL_EVENT_TYPES = [
  ExecutionCrossDomainEventTypes.ORDER_FILLED,
  ExecutionCrossDomainEventTypes.ORDER_PARTIALLY_FILLED,
  ExecutionCrossDomainEventTypes.ORDER_REJECTED,
  ExecutionCrossDomainEventTypes.ORDER_CANCELLED,
  ExecutionCrossDomainEventTypes.DEPOSIT_DETECTED,
  ExecutionCrossDomainEventTypes.WITHDRAWAL_COMPLETED,
  ExecutionCrossDomainEventTypes.CORPORATE_ACTION_APPLIED,
] as const;

const SIMULATION_EVENT_TYPES = [
  AdvisoryCrossDomainEventTypes.DECISION_PACKET_CREATED,
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
  taxLotManager: new TaxLotManager(repository),
};

export const handler = createIngestionHandler({
  serviceName: 'ledger-ctrl',
  handlers: createHandlers(deps),
  errorEventType: 'LEDGER_PROCESSING_FAILED',
});
