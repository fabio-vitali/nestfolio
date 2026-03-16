import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/event-processor';
import { NotificationRepository } from '../repositories/notification.repository';
import { NotificationLifecycleService } from '../services/notification-lifecycle.service';
import { NotificationDeliveryService } from '../services/notification-delivery.service';

export interface EventListenerDeps {
  readonly lifecycleService: NotificationLifecycleService;
}

const EVENT_TYPES = [
  'ONBOARDING_COMPLETED', 'MANDATE_GRANTED', 'GOAL_UPDATED', 'DEPOSIT_INITIATED',
  'OPERATING_MODE_CHANGED', 'DECISION_APPROVED', 'ORDER_FILLED', 'BALANCE_UPDATED',
] as const;

export const createHandlers = (deps: EventListenerDeps) =>
  Object.fromEntries(
    EVENT_TYPES.map((type) => [
      type,
      async (payload: EventPayload, ctx: EventContext) => {
        await deps.lifecycleService.executeNotificationLifecycle({
          tenantId: ctx.tenantId,
          triggerEvent: {
            id: ctx.eventId, type: ctx.eventType, timestamp: ctx.timestamp,
            subject: payload.subject, context: payload.context ?? { tenantId: ctx.tenantId },
          },
        });
        return skip();
      },
    ]),
  );

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new NotificationRepository(TABLE_NAME, dynamoClient);
const lifecycleService = new NotificationLifecycleService(repository, new NotificationDeliveryService());
const deps: EventListenerDeps = { lifecycleService };

export const handler = createEventHandler({
  serviceName: 'investor-ctrl',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'INVESTOR_CTRL_FAILED',
});
