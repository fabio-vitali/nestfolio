import { logger, getTime } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/event-processor';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { materializeToTable, record, skip, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { AdvisoryCrossDomainEventTypes } from '@nestfolio/advisory-adpt/domain';
import { InvestorCrossDomainEventTypes } from '@nestfolio/investor-adpt/domain';
import type { ProposedTrade } from '@nestfolio/advisory-adpt/domain';
import { OrderRepository } from '../repositories/order.repository';
import { SafetyChecksService } from '../services/safety-checks.service';
import { MarketHoursService } from '../services/market-hours.service';

export interface EventListenerDeps {
  readonly safetyChecks: SafetyChecksService;
  readonly marketHours: MarketHoursService;
}

function extractFromPayload(payload: EventPayload, ctx: EventContext): {
  tenantId: string;
  orderId: string;
  decisionPacketId: string;
  proposedTrades: ProposedTrade[];
} {
  const context = (payload.context ?? {}) as Record<string, unknown>;
  const subject = (payload.subject ?? {}) as Record<string, unknown>;
  const tenantId = (context['tenantId'] ?? ctx.tenantId ?? '') as string;
  const decisionPacketId = (subject['decisionPacketId'] ?? context['decisionPacketId'] ?? '') as string;
  const proposedTrades = ((subject['proposedTrades'] ?? []) as ProposedTrade[]);
  return { tenantId, orderId: ctx.eventId, decisionPacketId, proposedTrades };
}

async function processApprovedDecision(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
): Promise<WriteIntent | WriteIntent[]> {
  const { tenantId, orderId, decisionPacketId, proposedTrades } = extractFromPayload(payload, ctx);
  const now = getTime();

  logger.info('Processing approved decision', { tenantId, decisionPacketId, orderId, tradeCount: proposedTrades.length });

  const safetyResult = await deps.safetyChecks.runAllChecks(tenantId, proposedTrades);

  if (!safetyResult.passed) {
    logger.info('Safety checks failed, rejecting order', { orderId, reason: safetyResult.reason });
    return record('Order', {
      __typename: 'Order',
      tenantId,
      orderId,
      decisionPacketId,
      proposedTrades,
      status: 'REJECTED',
      reason: safetyResult.reason,
      sourceEventId: ctx.eventId,
      createdAt: now,
      updatedAt: now,
      timestamp: now,
    }, { pk: `Order#${tenantId}#${orderId}`, sk: 'Order' });
  }

  if (await deps.marketHours.isMarketOpen()) {
    logger.info('Market open, submitting order', { orderId });
    return record('Order', {
      __typename: 'Order',
      tenantId,
      orderId,
      decisionPacketId,
      proposedTrades,
      status: 'SUBMITTED',
      sourceEventId: ctx.eventId,
      createdAt: now,
      updatedAt: now,
      timestamp: now,
    }, { pk: `Order#${tenantId}#${orderId}`, sk: 'Order' });
  }

  logger.info('Market closed, staging order', { orderId });
  return [
    record('Order', {
      __typename: 'Order',
      tenantId,
      orderId,
      decisionPacketId,
      proposedTrades,
      status: 'STAGED',
      sourceEventId: ctx.eventId,
      createdAt: now,
      updatedAt: now,
      timestamp: now,
    }, { pk: `Order#${tenantId}#${orderId}`, sk: 'Order' }),
    record('StagedOrder', {
      __typename: 'StagedOrder',
      tenantId,
      orderId,
      proposedTrades,
      stagedAt: now,
      timestamp: now,
    }, { pk: `StagedOrder#${tenantId}#${orderId}`, sk: 'StagedOrder' }),
  ];
}

export function createHandlers(deps: EventListenerDeps): Record<string, (payload: EventPayload, ctx: EventContext) => Promise<WriteIntent | WriteIntent[]>> {
  return {
    [AdvisoryCrossDomainEventTypes.DECISION_APPROVED]: (payload, ctx) =>
      processApprovedDecision(deps, payload, ctx),

    [AdvisoryCrossDomainEventTypes.USER_CONFIRMED]: (payload, ctx) =>
      processApprovedDecision(deps, payload, ctx),

    [AdvisoryCrossDomainEventTypes.CIRCUIT_BREAKER_TRIGGERED]: async (_payload, ctx) => {
      logger.info('Circuit breaker triggered — execution paused', { eventId: ctx.eventId });
      return skip();
    },

    [AdvisoryCrossDomainEventTypes.CIRCUIT_BREAKER_RESET]: async (_payload, ctx) => {
      logger.info('Circuit breaker reset — execution resumed', { eventId: ctx.eventId });
      return skip();
    },

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
