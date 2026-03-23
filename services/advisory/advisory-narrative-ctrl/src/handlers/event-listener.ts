import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  resumeStateMachine, record,
  type EventPayload, type EventContext,
  requireEnv, logger,
} from '@nestfolio/event-processor';
import { createMemoryClient, createNoOpMemoryClient, type MemoryClient } from '@nestfolio/agent-orchestrator';
import { createAgentService } from '../agent-service';

export interface SfnCallbackDeps {
  readonly agentService: { runPipeline: (event: Record<string, unknown>) => Promise<Record<string, unknown>> };
  readonly feedbackCorrelator: { process: (event: Record<string, unknown>) => Promise<void> };
  readonly memoryClient: MemoryClient;
}

export const createHandlers = (deps: SfnCallbackDeps) => ({
  GENERATE_NARRATIVE: async (payload: EventPayload, ctx: EventContext) => {
    const subject = payload.subject ?? {};
    const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
    const decisionId = subject.decisionId as string;

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
      investorProfile: investorRecords[0]?.content ? JSON.parse(investorRecords[0].content) : {},
      marketAnalysis: marketRecords[0]?.content ? JSON.parse(marketRecords[0].content) : {},
      portfolio: portfolioRecords[0]?.content ? JSON.parse(portfolioRecords[0].content) : {},
      preferences: preferences.map(r => r.content),
      sessionHistory: sessionHistory.map(r => r.content),
    });

    await session.writeAgentOutput(result);

    return {
      output: { decisionId, tenantId },
      intents: [record('AgentInvocation', { decisionId, tenantId, agentName: 'advisory-narrative' })],
    };
  },

  DECISION_FEEDBACK: async (payload: EventPayload, ctx: EventContext) => {
    logger.info('Processing DECISION_FEEDBACK', { eventType: ctx.eventType });
    await deps.feedbackCorrelator.process({
      type: ctx.eventType,
      subject: payload.subject,
    } as Record<string, unknown>);
    return { output: { eventType: ctx.eventType, status: 'processed' } };
  },
});

// --- Production wiring ---

const TABLE_NAME = requireEnv('TABLE_NAME');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const agentService = createAgentService({ docClient, tableName: TABLE_NAME });

const feedbackCorrelator = {
  process: async (_event: Record<string, unknown>) => {
    // Delegated to feedback-correlator — invoked inline here
    // In production, this would load from DDB, annotate, and write to S3
  },
};

const memoryClient = process.env.MEMORY_ID
  ? createMemoryClient({ memoryId: process.env.MEMORY_ID, region: process.env.AWS_REGION ?? 'us-east-1', serviceName: 'advisory-narrative' })
  : createNoOpMemoryClient();

const deps: SfnCallbackDeps = { agentService, feedbackCorrelator, memoryClient };

export const handler = resumeStateMachine({
  serviceName: 'advisory-narrative-ctrl',
  handlers: createHandlers(deps),
  errorEventType: 'ADVISORY_NARRATIVE_CTRL_FAILED',
});
