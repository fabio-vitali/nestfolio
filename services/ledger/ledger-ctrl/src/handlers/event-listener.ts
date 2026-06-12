import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createIngestionHandler, skip, parseSubject, pickRequestContext, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/event-processor';
import { getTime, logger } from '@nestfolio/event-processor';
import { NormalizedOrderEventSchema, FundingSnapshotSchema, ExecutionCrossDomainEventTypes } from '@nestfolio/execution-adpt/domain';
import { AdvisoryCrossDomainEventTypes, DecisionPacketSchema } from '@nestfolio/advisory-adpt/domain';
import { LedgerRepository } from '../repositories/ledger.repository';
import { ShadowFillService, type ProposedTrade } from '../services/shadow-fill.service';
import { TaxLotManager } from '../services/tax-lot-manager';

export interface EventListenerDeps {
  readonly repository: LedgerRepository;
  readonly shadowFill: ShadowFillService;
  readonly taxLotManager: TaxLotManager;
}

// ---------------------------------------------------------------------------
// ORDER_* actual events (cross-domain: ledger←execution via execution-adpt)
// ---------------------------------------------------------------------------

async function processOrderActualEvent(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
) {
  const subject = parseSubject(payload, NormalizedOrderEventSchema);

  // identity fields come from ctx (DRY subjects); only read genuine payload fields from subject
  const eventPayload: Record<string, unknown> = {
    ...subject,
    // boundary: NormalizedOrderEventSchema is the DRY producer contract (broker-ctrl CDC publisher
    // strips symbol/side/quantity/filledQuantity/fillPrice to the declared contract fields only).
    // These reads return undefined in production; kept for structural parity with the raw spread.
  };

  const sequenceNo = await deps.repository.nextSequence(ctx.tenantId, 'actual');

  const created = await deps.repository.putLedgerEntry({
    streamType: 'actual',
    eventId: ctx.eventId,
    eventType: ctx.eventType,
    payload: eventPayload,
    timestamp: ctx.timestamp,
    sequenceNo,
    decisionId: undefined, // NormalizedOrderEvent carries no decisionId
  }, pickRequestContext(ctx));

  if (!created) {
    logger.info('Duplicate ledger entry, skipping', { eventType: ctx.eventType, eventId: ctx.eventId });
  }

  // Tax lot tracking for live fills
  if (ctx.eventType === ExecutionCrossDomainEventTypes.ORDER_FILLED && subject.executionMode === 'live') {
    // boundary: NormalizedOrderEventSchema is the DRY producer contract — side/symbol/
    // filledQty→quantity/fillPrice fields are read here; filledQty maps to NormalizedOrderEvent.filledQty
    const side = (payload.subject as Record<string, unknown>)?.['side'] as string | undefined;
    const symbol = (payload.subject as Record<string, unknown>)?.['symbol'] as string | undefined;
    const rawSubject = payload.subject as Record<string, unknown> | undefined;
    if (side === 'BUY') {
      await deps.taxLotManager.openLot({
        tenantId: ctx.tenantId,
        orderId: subject.orderId,
        symbol: symbol ?? '',
        quantity: subject.filledQty ?? (rawSubject?.['filledQuantity'] as number | undefined) ?? (rawSubject?.['quantity'] as number | undefined) ?? 0,
        costBasisPerShare: subject.averageFillPrice ?? (rawSubject?.['fillPrice'] as number | undefined) ?? 0,
        acquiredAt: ctx.timestamp,
      });
    } else if (side === 'SELL') {
      await deps.taxLotManager.closeLots({
        tenantId: ctx.tenantId,
        symbol: symbol ?? '',
        quantity: subject.filledQty ?? (rawSubject?.['filledQuantity'] as number | undefined) ?? (rawSubject?.['quantity'] as number | undefined) ?? 0,
        salePrice: subject.averageFillPrice ?? (rawSubject?.['fillPrice'] as number | undefined) ?? 0,
        soldAt: ctx.timestamp,
        orderId: subject.orderId,
      });
    }
  }

  return skip();
}

// ---------------------------------------------------------------------------
// DEPOSIT_SETTLED / WITHDRAWAL_SETTLED actual events (cross-domain: ledger←execution)
// ---------------------------------------------------------------------------

async function processFundingActualEvent(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
) {
  const subject = parseSubject(payload, FundingSnapshotSchema);

  const eventPayload: Record<string, unknown> = { ...subject };

  const sequenceNo = await deps.repository.nextSequence(ctx.tenantId, 'actual');

  const created = await deps.repository.putLedgerEntry({
    streamType: 'actual',
    eventId: ctx.eventId,
    eventType: ctx.eventType,
    payload: eventPayload,
    timestamp: ctx.timestamp,
    sequenceNo,
    decisionId: undefined, // FundingSnapshot carries no decisionId
  }, pickRequestContext(ctx));

  if (!created) {
    logger.info('Duplicate ledger entry, skipping', { eventType: ctx.eventType, eventId: ctx.eventId });
  }

  return skip();
}

// ---------------------------------------------------------------------------
// CORPORATE_ACTION_APPLIED actual event
// boundary: no producer CDC contract for CORPORATE_ACTION_APPLIED — ledger-ctrl
// stores the raw subject for audit purposes only (no specific field reads needed).
// ---------------------------------------------------------------------------

async function processCorporateActionEvent(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
) {
  // boundary: CORPORATE_ACTION_APPLIED — no producer zod contract in execution-adpt/domain.
  // The ledger entry is a generic audit store; no typed field reads are needed.
  const eventPayload: Record<string, unknown> = { ...(payload.subject as Record<string, unknown> ?? {}) };

  const sequenceNo = await deps.repository.nextSequence(ctx.tenantId, 'actual');

  const created = await deps.repository.putLedgerEntry({
    streamType: 'actual',
    eventId: ctx.eventId,
    eventType: ctx.eventType,
    payload: eventPayload,
    timestamp: ctx.timestamp,
    sequenceNo,
    decisionId: undefined,
  }, pickRequestContext(ctx));

  if (!created) {
    logger.info('Duplicate ledger entry, skipping', { eventType: ctx.eventType, eventId: ctx.eventId });
  }

  return skip();
}

// ---------------------------------------------------------------------------
// DECISION_PACKET_CREATED simulation event (cross-domain: ledger←advisory via advisory-adpt)
// ---------------------------------------------------------------------------

async function processSimulationEvent(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
) {
  const subject = parseSubject(payload, DecisionPacketSchema);

  // DecisionPacketSchema carries `decisionId` (the DRY field); `decisionPacketId` is not on the schema.
  const decisionPacketId = subject.decisionId ?? ctx.eventId;
  const proposedTrades = (subject.proposedTrades ?? []) as ProposedTrade[];

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
      eventType: ExecutionCrossDomainEventTypes.ORDER_FILLED,
      payload: {
        orderId: `sim-${decisionPacketId}-${trade.symbol}`,
        symbol: trade.symbol,
        side: trade.side,
        quantity: fillResult.derivedQuantity,
        amountCents: trade.quantityOrAmountCents,
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

const ORDER_EVENT_TYPES = [
  ExecutionCrossDomainEventTypes.ORDER_FILLED,
  ExecutionCrossDomainEventTypes.ORDER_PARTIALLY_FILLED,
  ExecutionCrossDomainEventTypes.ORDER_REJECTED,
  ExecutionCrossDomainEventTypes.ORDER_CANCELLED,
] as const;

const FUNDING_EVENT_TYPES = [
  ExecutionCrossDomainEventTypes.DEPOSIT_SETTLED,
  ExecutionCrossDomainEventTypes.WITHDRAWAL_SETTLED,
] as const;

const SIMULATION_EVENT_TYPES = [
  AdvisoryCrossDomainEventTypes.DECISION_PACKET_CREATED,
] as const;

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<ReturnType<typeof skip>>> = {};

  for (const type of ORDER_EVENT_TYPES) {
    handlers[type] = (payload, ctx) => processOrderActualEvent(deps, payload, ctx);
  }

  for (const type of FUNDING_EVENT_TYPES) {
    handlers[type] = (payload, ctx) => processFundingActualEvent(deps, payload, ctx);
  }

  handlers[ExecutionCrossDomainEventTypes.CORPORATE_ACTION_APPLIED] =
    (payload, ctx) => processCorporateActionEvent(deps, payload, ctx);

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
