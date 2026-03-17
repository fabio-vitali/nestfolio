/* eslint-disable @typescript-eslint/no-explicit-any */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  createEventHandler, skip,
  type EventPayload, type EventContext,
  requireEnv, logger,
} from '@nestfolio/event-processor';
import { HANDLED_EVENT_TYPES } from '../service-domain';
import { createAgentService } from '../agent-service';

export interface EventListenerDeps {
  readonly agentService: { runPipeline: (event: Record<string, unknown>) => Promise<Record<string, unknown>> };
  readonly bus: { publish: (events: Array<{ type: string; subject: Record<string, unknown> }>) => Promise<void> };
}

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<ReturnType<typeof skip>>> = {};

  handlers['ANALYZE_MARKET'] = async (payload, ctx) => {
    const subject = payload.subject ?? {};
    const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
    const decisionId = subject.decisionId as string;
    const taskToken = subject.taskToken as string;

    logger.info('Processing ANALYZE_MARKET', { decisionId, tenantId });

    const result = await deps.agentService.runPipeline({
      tenantId,
      decisionId,
      taskToken,
      upstreamOutputs: subject.upstreamOutputs ?? {},
    });

    await deps.bus.publish([{
      type: 'MARKET_ANALYSIS_COMPLETED',
      subject: {
        decisionId,
        tenantId,
        taskToken,
        outputs: result,
      },
    }]);

    logger.info('Published MARKET_ANALYSIS_COMPLETED', { decisionId });
    return skip();
  };

  return handlers;
};

// --- Production wiring ---

const TABLE_NAME = requireEnv('TABLE_NAME');
const BUS_NAME = requireEnv('BUS_NAME');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const ebClient = new EventBridgeClient({});

const agentService = createAgentService({ docClient, tableName: TABLE_NAME });

const bus = {
  publish: async (events: Array<{ type: string; subject: Record<string, unknown> }>) => {
    await ebClient.send(new PutEventsCommand({
      Entries: events.map((e) => ({
        EventBusName: BUS_NAME,
        Source: 'nestfolio.market-intelligence-ctrl',
        DetailType: e.type,
        Detail: JSON.stringify({ type: e.type, subject: e.subject }),
      })),
    }));
  },
};

const deps: EventListenerDeps = { agentService, bus };

export const handler = createEventHandler({
  serviceName: 'market-intelligence-ctrl',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: BUS_NAME,
  errorEventType: 'MARKET_INTELLIGENCE_CTRL_FAILED',
});
