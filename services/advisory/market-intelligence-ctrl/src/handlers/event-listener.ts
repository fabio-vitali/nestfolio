import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  createEventHandler, skip,
  type EventPayload, type EventContext,
  requireEnv, logger,
} from '@nestfolio/event-processor';
import { createMemoryClient, createNoOpMemoryClient, type MemoryClient } from '@nestfolio/agent-orchestrator';
import { createAgentService } from '../agent-service';

export interface EventListenerDeps {
  readonly agentService: { runPipeline: (event: Record<string, unknown>) => Promise<Record<string, unknown>> };
  readonly bus: { publish: (events: Array<{ type: string; subject: Record<string, unknown> }>) => Promise<void> };
  readonly memoryClient: MemoryClient;
}

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<ReturnType<typeof skip>>> = {};

  handlers['ANALYZE_MARKET'] = async (payload, ctx) => {
    const subject = payload.subject ?? {};
    const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
    const decisionId = subject.decisionId as string;
    const taskToken = subject.taskToken as string;

    logger.info('Processing ANALYZE_MARKET', { decisionId, tenantId });

    const session = deps.memoryClient.openDecisionSession(tenantId, decisionId);
    const tenantHistory = await session.searchLongTermMemory('market signals sector trends');

    const result = await deps.agentService.runPipeline({
      tenantId,
      decisionId,
      taskToken,
      tenantHistory: tenantHistory.map(r => r.content),
    });

    await session.writeAgentOutput(result);

    await deps.bus.publish([{
      type: 'MARKET_ANALYSIS_COMPLETED',
      subject: {
        decisionId,
        tenantId,
        taskToken,
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

const memoryClient = process.env.MEMORY_ID
  ? createMemoryClient({ memoryId: process.env.MEMORY_ID, region: process.env.AWS_REGION ?? 'us-east-1', serviceName: 'market-intelligence' })
  : createNoOpMemoryClient();

const deps: EventListenerDeps = { agentService, bus, memoryClient };

export const handler = createEventHandler({
  serviceName: 'market-intelligence-ctrl',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: BUS_NAME,
  errorEventType: 'MARKET_INTELLIGENCE_CTRL_FAILED',
});
