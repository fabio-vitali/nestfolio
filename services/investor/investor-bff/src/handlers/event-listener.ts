import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/lambda-utils';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';
import { UserRegisteredPipe } from '../pipes/user-registered.pipe';
import { NotificationCreatedPipe } from '../pipes/notification-created.pipe';
import { BalanceUpdatedPipe } from '../pipes/balance-updated.pipe';

export interface EventListenerDeps {
  readonly userRegisteredPipe: UserRegisteredPipe;
  readonly notificationCreatedPipe: NotificationCreatedPipe;
  readonly balanceUpdatedPipe: BalanceUpdatedPipe;
}

function toUow(payload: EventPayload, ctx: EventContext) {
  const event = {
    id: ctx.eventId, type: ctx.eventType, timestamp: ctx.timestamp,
    subject: payload.subject, context: payload.context ?? { tenantId: ctx.tenantId },
  };
  return { event, payload: payload.subject as Record<string, unknown>, record: {} };
}

export const createHandlers = (deps: EventListenerDeps) => ({
  'USER_REGISTERED': async (payload: EventPayload, ctx: EventContext) => {
    await deps.userRegisteredPipe.process(toUow(payload, ctx) as any);
    return skip();
  },
  'NOTIFICATION_CREATED': async (payload: EventPayload, ctx: EventContext) => {
    await deps.notificationCreatedPipe.process(toUow(payload, ctx) as any);
    return skip();
  },
  'BALANCE_UPDATED': async (payload: EventPayload, ctx: EventContext) => {
    await deps.balanceUpdatedPipe.process(toUow(payload, ctx) as any);
    return skip();
  },
});

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new InvestorProfileRepository(TABLE_NAME, dynamoClient);

const deps: EventListenerDeps = {
  userRegisteredPipe: new UserRegisteredPipe(repository),
  notificationCreatedPipe: new NotificationCreatedPipe(repository),
  balanceUpdatedPipe: new BalanceUpdatedPipe(repository),
};

export const handler = createEventHandler({
  serviceName: 'investor-bff',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'INVESTOR_BFF_FAILED',
});
