import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/lambda-utils';
import { AdvisoryRepository } from '../repositories/advisory.repository';
import { DecisionPacketCreatedPipe } from '../pipes/decision-packet-created.pipe';
import { DecisionStatusChangedPipe } from '../pipes/decision-status-changed.pipe';

export interface EventListenerDeps {
  readonly decisionPacketCreatedPipe: DecisionPacketCreatedPipe;
  readonly decisionStatusChangedPipe: DecisionStatusChangedPipe;
}

function toUow(payload: EventPayload, ctx: EventContext) {
  const event = {
    id: ctx.eventId, type: ctx.eventType, timestamp: ctx.timestamp,
    subject: payload.subject, context: payload.context ?? { tenantId: ctx.tenantId },
  };
  return { event, payload: payload.subject as Record<string, unknown>, record: {} };
}

export const createHandlers = (deps: EventListenerDeps) => ({
  'DECISION_PACKET_CREATED': async (payload: EventPayload, ctx: EventContext) => {
    await deps.decisionPacketCreatedPipe.process(toUow(payload, ctx) as any);
    return skip();
  },
  'DECISION_PACKET_ENRICHED': async (payload: EventPayload, ctx: EventContext) => {
    await deps.decisionStatusChangedPipe.process(toUow(payload, ctx) as any);
    return skip();
  },
  'DECISION_APPROVED': async (payload: EventPayload, ctx: EventContext) => {
    await deps.decisionStatusChangedPipe.process(toUow(payload, ctx) as any);
    return skip();
  },
  'DECISION_BLOCKED': async (payload: EventPayload, ctx: EventContext) => {
    await deps.decisionStatusChangedPipe.process(toUow(payload, ctx) as any);
    return skip();
  },
  'USER_CONFIRMATION_REQUESTED': async (payload: EventPayload, ctx: EventContext) => {
    await deps.decisionStatusChangedPipe.process(toUow(payload, ctx) as any);
    return skip();
  },
});

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new AdvisoryRepository(TABLE_NAME, dynamoClient);

const deps: EventListenerDeps = {
  decisionPacketCreatedPipe: new DecisionPacketCreatedPipe(repository),
  decisionStatusChangedPipe: new DecisionStatusChangedPipe(repository),
};

export const handler = createEventHandler({
  serviceName: 'advisory-bff',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'ADVISORY_BFF_FAILED',
});
