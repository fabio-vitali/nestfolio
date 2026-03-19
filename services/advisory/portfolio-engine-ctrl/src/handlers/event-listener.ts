import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import {
  createEventHandler, skip,
  type EventPayload, type EventContext,
  requireEnv, logger,
} from '@nestfolio/event-processor';
import { createMemoryClient, createNoOpMemoryClient, type MemoryClient } from '@nestfolio/agent-core';
import { KB_INGESTION_EVENT_TYPES } from '../service-domain';
import { createAgentService } from '../agent-service';

export interface EventListenerDeps {
  readonly agentService: { runPipeline: (event: Record<string, unknown>) => Promise<Record<string, unknown>> };
  readonly kbIngestionHandler: { ingest: (event: Record<string, unknown>, eventType: string) => Promise<void> };
  readonly bus: { publish: (events: Array<{ type: string; subject: Record<string, unknown> }>) => Promise<void> };
  readonly memoryClient: MemoryClient;
}

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<ReturnType<typeof skip>>> = {};

  handlers['CONSTRUCT_PORTFOLIO'] = async (payload, ctx) => {
    const subject = payload.subject ?? {};
    const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
    const decisionId = subject.decisionId as string;
    const taskToken = subject.taskToken as string;

    logger.info('Processing CONSTRUCT_PORTFOLIO', { decisionId, tenantId });

    const session = deps.memoryClient.openDecisionSession(tenantId, decisionId);

    const [investorRecords, marketRecords, pastRationale] = await Promise.all([
      session.readUpstreamOutput('investor-profile'),
      session.readUpstreamOutput('market-intelligence'),
      session.searchLongTermMemory('allocation rationale decisions'),
    ]);

    const result = await deps.agentService.runPipeline({
      tenantId,
      decisionId,
      taskToken,
      investorProfile: investorRecords[0]?.content ? JSON.parse(investorRecords[0].content) : {},
      marketAnalysis: marketRecords[0]?.content ? JSON.parse(marketRecords[0].content) : {},
      pastRationale: pastRationale.map(r => r.content),
    });

    await session.writeAgentOutput(result);

    await deps.bus.publish([{
      type: 'PORTFOLIO_COMPLETED',
      subject: {
        decisionId,
        tenantId,
        taskToken,
      },
    }]);

    logger.info('Published PORTFOLIO_COMPLETED', { decisionId });
    return skip();
  };

  // KB ingestion events
  for (const eventType of KB_INGESTION_EVENT_TYPES) {
    handlers[eventType] = async (payload, ctx) => {
      await deps.kbIngestionHandler.ingest(
        { type: ctx.eventType, subject: payload.subject } as Record<string, unknown>,
        ctx.eventType,
      );
      return skip();
    };
  }

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
        Source: 'nestfolio.portfolio-engine-ctrl',
        DetailType: e.type,
        Detail: JSON.stringify({ type: e.type, subject: e.subject }),
      })),
    }));
  },
};

const kbIngestionHandler = {
  ingest: async (_event: Record<string, unknown>, _eventType: string) => {
    // Delegated to kb-ingestion-handler Lambda via Ingress routing
  },
};

const memoryClient = process.env.MEMORY_ID
  ? createMemoryClient({ memoryId: process.env.MEMORY_ID, region: process.env.AWS_REGION ?? 'us-east-1', serviceName: 'portfolio-engine' })
  : createNoOpMemoryClient();

const deps: EventListenerDeps = { agentService, bus, kbIngestionHandler, memoryClient };

export const handler = createEventHandler({
  serviceName: 'portfolio-engine-ctrl',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: BUS_NAME,
  errorEventType: 'PORTFOLIO_ENGINE_CTRL_FAILED',
});
