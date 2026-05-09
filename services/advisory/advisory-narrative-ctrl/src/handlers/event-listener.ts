import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  resumeStateMachine, record,
  type EventPayload, type EventContext,
  requireEnv, logger,
} from '@nestfolio/event-processor';
import { createMemoryClient, createNoOpMemoryClient, type MemoryClient, UnknownOperatingModeError } from '@nestfolio/agent-orchestrator';
import { createAgentService, DuplicateInvocationError } from '../agent-service';

export interface SfnCallbackDeps {
  readonly agentService: { runPipeline: (eventId: string, event: Record<string, unknown>) => Promise<Record<string, unknown>> };
  readonly feedbackCorrelator: { process: (event: Record<string, unknown>) => Promise<void> };
  readonly memoryClient: MemoryClient;
}

export const createHandlers = (deps: SfnCallbackDeps) => ({
  GENERATE_NARRATIVE: async (payload: EventPayload, ctx: EventContext) => {
    const subject = payload.subject ?? {};
    const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
    const decisionId = subject.decisionId as string;

    logger.info('Processing GENERATE_NARRATIVE', { decisionId, tenantId });

    // operatingMode is propagated through SF state from InvokeInvestorProfile
    // (subject.operatingMode is wired in decision-state-machine.ts via
    // $.agentResults.InvokeInvestorProfile.operatingMode). Reading it from the
    // event subject avoids the >40s AgentCore Memory ListMemoryRecords
    // eventual-consistency window — see
    // docs/backlog/agentcore-memory-list-records-eventual-consistency.md.
    const operatingMode = subject.operatingMode as string | undefined;
    if (!operatingMode) {
      throw new UnknownOperatingModeError({
        decisionId,
        resolutionPath: 'subject.operatingMode (propagated by SF from InvokeInvestorProfile result)',
        availableKeys: Object.keys(subject),
      });
    }

    const session = deps.memoryClient.openDecisionSession(tenantId, decisionId);

    // Memory reads — AgentCore ListMemoryRecords has >40s eventual consistency
    // window. Retry on the upstream `portfolio-engine` record (the most recent
    // write in the chain — investor-profile/market-intelligence are typically
    // converged by this stage). Tests short-circuit via the env override.
    // operatingMode is NOT gated on Memory — it comes from subject above.
    const [investorRecords, marketRecords, portfolioRecordsInitial, preferences, sessionHistory] = await Promise.all([
      session.readUpstreamOutput('investor-profile'),
      session.readUpstreamOutput('market-intelligence'),
      session.readUpstreamOutput('portfolio-engine'),
      session.searchLongTermMemory('narrative preferences communication style'),
      session.searchLongTermMemory('session summaries'),
    ]);

    let portfolioRecords = portfolioRecordsInitial;
    const retryDelays = (process.env.MEMORY_READ_RETRY_DELAYS_MS_OVERRIDE
      ?? '3000,5000,8000,12000')
      .split(',').map((s) => parseInt(s.trim(), 10));
    for (const delay of retryDelays) {
      if (portfolioRecords[0]?.content) break;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      portfolioRecords = await session.readUpstreamOutput('portfolio-engine');
    }

    const investorProfile = investorRecords[0]?.content ? JSON.parse(investorRecords[0].content) : {};

    let result: Record<string, unknown>;
    try {
      result = await deps.agentService.runPipeline(ctx.eventId, {
        tenantId,
        decisionId,
        operatingMode,
        investorProfile,
        marketAnalysis: marketRecords[0]?.content ? JSON.parse(marketRecords[0].content) : {},
        portfolio: portfolioRecords[0]?.content ? JSON.parse(portfolioRecords[0].content) : {},
        preferences: preferences.map(r => r.content),
        sessionHistory: sessionHistory.map(r => r.content),
      });
    } catch (error) {
      if (error instanceof DuplicateInvocationError) {
        logger.info('Duplicate GENERATE_NARRATIVE event, skipping', { eventId: ctx.eventId, decisionId });
        return { output: { decisionId, tenantId, deduplicated: true } };
      }
      throw error;
    }

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
