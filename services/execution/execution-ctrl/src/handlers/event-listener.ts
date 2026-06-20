import { logger, getTime, parseSubject } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/event-processor';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { z } from 'zod';
import { materializeToTable, record, skip, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import '../read-model-ownership';
import { AdvisoryCrossDomainEventTypes, ComplianceCheckSchema, UserConfirmationSchema, ProposedTradeSchema, type ProposedTrade } from '@nestfolio/advisory-adpt/domain';
import { InvestorCrossDomainEventTypes } from '@nestfolio/investor-adpt/domain';
import type { Order, StagedOrder } from '../domain/contracts';
import { OrderRepository } from '../repositories/order.repository';
import { SafetyChecksService } from '../services/safety-checks.service';
import { MarketHoursService } from '../services/market-hours.service';

export interface EventListenerDeps {
  readonly safetyChecks: SafetyChecksService;
  readonly marketHours: MarketHoursService;
}

const ProposedTradesArray = z.array(ProposedTradeSchema);

interface ApprovedDecision {
  tenantId: string;
  authorizingEventId: string;
  decisionPacketId: string;
  proposedTrades: ProposedTrade[];
}

// DECISION_APPROVED = ComplianceCheck. proposedTrades carried on the subject since WS-1
// (opaque unknown[]); parsed to typed ProposedTrade[] here. A malformed trade ⇒ ZodError ⇒ DLQ.
function fromDecisionApproved(payload: EventPayload, ctx: EventContext): ApprovedDecision {
  const subject = parseSubject(payload, ComplianceCheckSchema);
  return {
    tenantId: ctx.tenantId ?? '',
    authorizingEventId: ctx.eventId,
    decisionPacketId: subject.decisionPacketId,
    proposedTrades: ProposedTradesArray.parse(subject.proposedTrades ?? []),
  };
}

// USER_CONFIRMED = UserConfirmation. Carries decisionId (not decisionPacketId) + proposedTrades (WS-1).
function fromUserConfirmed(payload: EventPayload, ctx: EventContext): ApprovedDecision {
  const subject = parseSubject(payload, UserConfirmationSchema);
  return {
    tenantId: ctx.tenantId ?? '',
    authorizingEventId: ctx.eventId,
    decisionPacketId: subject.decisionId,
    proposedTrades: ProposedTradesArray.parse(subject.proposedTrades ?? []),
  };
}

async function processApprovedDecision(
  deps: EventListenerDeps,
  approved: ApprovedDecision,
  ctx: EventContext,
): Promise<WriteIntent | WriteIntent[]> {
  const { tenantId, authorizingEventId, decisionPacketId, proposedTrades } = approved;
  const now = getTime();

  if (proposedTrades.length === 0) {
    logger.warn('Approved decision carried no proposed trades — nothing to execute', { tenantId, decisionPacketId, authorizingEventId });
    return skip();
  }

  const marketOpen = await deps.marketHours.isMarketOpen();
  logger.info('Expanding approved decision into per-trade orders', { tenantId, decisionPacketId, authorizingEventId, tradeCount: proposedTrades.length, marketOpen });

  const intents: WriteIntent[] = [];

  for (const [index, t] of proposedTrades.entries()) {
    const orderId = `${authorizingEventId}#${index}`;
    const safetyResult = await deps.safetyChecks.runAllChecks(tenantId, [t.symbol]);

    const base = {
      orderId,
      decisionPacketId,
      symbol: t.symbol,
      side: t.side,
      quantityOrAmountCents: t.quantityOrAmountCents,
      sourceEventId: ctx.eventId,
      timestamp: now,
    };
    const orderRow = (order: Order): WriteIntent =>
      record('Order', { __typename: 'Order', tenantId, ...order, createdAt: now, updatedAt: now }, { pk: `Order#${tenantId}#${orderId}`, sk: 'Order' });

    if (!safetyResult.passed) {
      logger.info('Safety checks failed, rejecting order', { orderId, symbol: t.symbol, reason: safetyResult.reason });
      intents.push(orderRow({ ...base, status: 'REJECTED', reason: safetyResult.reason }));
      continue;
    }

    if (marketOpen) {
      intents.push(orderRow({ ...base, status: 'SUBMITTED' }));
      continue;
    }

    const stagedSubject: StagedOrder = { orderId, symbol: t.symbol, side: t.side, quantityOrAmountCents: t.quantityOrAmountCents, stagedAt: now, timestamp: now };
    intents.push(
      orderRow({ ...base, status: 'STAGED' }),
      record('StagedOrder', { __typename: 'StagedOrder', tenantId, ...stagedSubject }, { pk: `StagedOrder#${tenantId}#${orderId}`, sk: 'StagedOrder' }),
    );
  }

  return intents;
}

export function createHandlers(deps: EventListenerDeps): Record<string, (payload: EventPayload, ctx: EventContext) => Promise<WriteIntent | WriteIntent[]>> {
  return {
    [AdvisoryCrossDomainEventTypes.DECISION_APPROVED]: (payload, ctx) =>
      processApprovedDecision(deps, fromDecisionApproved(payload, ctx), ctx),

    [AdvisoryCrossDomainEventTypes.USER_CONFIRMED]: (payload, ctx) =>
      processApprovedDecision(deps, fromUserConfirmed(payload, ctx), ctx),

    [InvestorCrossDomainEventTypes.ACCOUNT_CLOSURE_REQUESTED]: async (_payload, ctx) => {
      logger.info('Account closure requested', { eventId: ctx.eventId });
      return skip();
    },
  };
}

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new OrderRepository(TABLE_NAME, dynamoClient);
const safetyChecks = new SafetyChecksService(repository);
const marketHours = new MarketHoursService();

export const handler = materializeToTable({
  serviceName: 'execution-ctrl',
  handlers: createHandlers({ safetyChecks, marketHours }),
  errorEventType: 'EXECUTION_CTRL_FAILED',
});
