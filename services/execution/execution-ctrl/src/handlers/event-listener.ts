import { logger } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/event-processor';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { OrderRepository } from '../repositories/order.repository';
import { SafetyChecksService } from '../services/safety-checks.service';
import { MarketHoursService } from '../services/market-hours.service';
import { OrderLifecycleService } from '../services/order-lifecycle.service';

export interface EventListenerDeps {
  readonly repository: OrderRepository;
  readonly lifecycleService: OrderLifecycleService;
}

function toEvent(payload: EventPayload, ctx: EventContext): Record<string, unknown> {
  return {
    id: ctx.eventId,
    type: ctx.eventType,
    timestamp: ctx.timestamp,
    subject: payload.subject,
    context: payload.context ?? { tenantId: ctx.tenantId },
  };
}

export function createHandlers(deps: EventListenerDeps): Record<string, (payload: EventPayload, ctx: EventContext) => Promise<ReturnType<typeof skip>>> {
  return {
    DECISION_APPROVED: async (payload, ctx) => {
      await deps.lifecycleService.processApprovedDecision(toEvent(payload, ctx));
      return skip();
    },
    USER_CONFIRMED: async (payload, ctx) => {
      await deps.lifecycleService.processApprovedDecision(toEvent(payload, ctx));
      return skip();
    },
    CIRCUIT_BREAKER_TRIGGERED: async (_payload, ctx) => {
      logger.info('Circuit breaker triggered — execution paused', { eventId: ctx.eventId });
      return skip();
    },
    CIRCUIT_BREAKER_RESET: async (_payload, ctx) => {
      logger.info('Circuit breaker reset — execution resumed', { eventId: ctx.eventId });
      return skip();
    },
    ACCOUNT_CLOSURE_REQUESTED: async (_payload, ctx) => {
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
const lifecycleService = new OrderLifecycleService(repository, safetyChecks, marketHours);

export const handler = createEventHandler({
  serviceName: 'execution-ctrl',
  handlers: createHandlers({ repository, lifecycleService }),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'EXECUTION_CTRL_FAILED',
});
