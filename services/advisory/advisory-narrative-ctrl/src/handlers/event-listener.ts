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
  readonly feedbackCorrelator: { process: (event: Record<string, unknown>) => Promise<void> };
  readonly bus: { publish: (events: Array<{ type: string; subject: Record<string, unknown> }>) => Promise<void> };
  readonly memoryClient: MemoryClient;
}

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<ReturnType<typeof skip>>> = {};

  handlers['GENERATE_NARRATIVE'] = async (payload, ctx) => {
    const subject = payload.subject ?? {};
    const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
    const decisionId = subject.decisionId as string;
    const taskToken = subject.taskToken as string;

    logger.info('Processing GENERATE_NARRATIVE', { decisionId, tenantId });

    const session = deps.memoryClient.openDecisionSession(tenantId, decisionId);

    const [investorRecords, marketRecords, portfolioRecords, preferences, sessionHistory] = await Promise.all([
      session.readUpstreamOutput('investor-profile'),
      session.readUpstreamOutput('market-intelligence'),
      session.readUpstreamOutput('portfolio-engine'),
      session.searchLongTermMemory('narrative preferences communication style'),
      session.searchLongTermMemory('session summaries'),
    ]);

    const result = await deps.agentService.runPipeline({
      tenantId,
      decisionId,
      taskToken,
      investorProfile: investorRecords[0]?.content ? JSON.parse(investorRecords[0].content) : {},
      marketAnalysis: marketRecords[0]?.content ? JSON.parse(marketRecords[0].content) : {},
      portfolio: portfolioRecords[0]?.content ? JSON.parse(portfolioRecords[0].content) : {},
      preferences: preferences.map(r => r.content),
      sessionHistory: sessionHistory.map(r => r.content),
    });

    await session.writeAgentOutput(result);

    await deps.bus.publish([{
      type: 'NARRATIVE_COMPLETED',
      subject: {
        decisionId,
        tenantId,
        taskToken,
      },
    }]);

    logger.info('Published NARRATIVE_COMPLETED', { decisionId });
    return skip();
  };

  handlers['DECISION_FEEDBACK'] = async (payload, ctx) => {
    logger.info('Processing DECISION_FEEDBACK', { eventType: ctx.eventType });
    await deps.feedbackCorrelator.process({
      type: ctx.eventType,
      subject: payload.subject,
    } as Record<string, unknown>);
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
        Source: 'nestfolio.advisory-narrative-ctrl',
        DetailType: e.type,
        Detail: JSON.stringify({ type: e.type, subject: e.subject }),
      })),
    }));
  },
};

const feedbackCorrelator = {
  process: async (_event: Record<string, unknown>) => {
    // Delegated to feedback-correlator — invoked inline here
    // In production, this would load from DDB, annotate, and write to S3
  },
};

const memoryClient = process.env.MEMORY_ID
  ? createMemoryClient({ memoryId: process.env.MEMORY_ID, region: process.env.AWS_REGION ?? 'us-east-1', serviceName: 'advisory-narrative' })
  : createNoOpMemoryClient();

const deps: EventListenerDeps = { agentService, bus, feedbackCorrelator, memoryClient };

export const handler = createEventHandler({
  serviceName: 'advisory-narrative-ctrl',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: BUS_NAME,
  errorEventType: 'ADVISORY_NARRATIVE_CTRL_FAILED',
});
