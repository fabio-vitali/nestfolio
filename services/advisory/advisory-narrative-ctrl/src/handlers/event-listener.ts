import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  resumeStateMachine, record,
  type EventPayload, type EventContext,
  requireEnv, logger,
} from '@nestfolio/event-processor';
import { createMemoryClient, createNoOpMemoryClient, type MemoryClient, UnknownOperatingModeError, wrapAgentOutput } from '@nestfolio/agent-orchestrator';
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

    // Long-term recall reads (preferences + session history). These return []
    // today and will be populated by Phase B (long-term Memory strategies).
    const [preferences, sessionHistory] = await Promise.all([
      session.searchLongTermMemory('narrative preferences communication style'),
      session.searchLongTermMemory('session summaries'),
    ]);

    // Inter-agent ephemeral handoff: upstream outputs arrive via SF state
    // Parameters from $.agentResults.<Upstream>.agentOutput. No Memory reads,
    // no eventual-consistency wait. Empty/null upstreams are tolerated; the
    // agent input simply has empty objects in those slots (matches the
    // pre-migration Memory-empty behavior).
    const investorProfile = (subject.investorProfile as Record<string, unknown> | undefined) ?? {};
    const marketAnalysis = (subject.marketAnalysis as Record<string, unknown> | undefined) ?? {};
    const portfolio = (subject.portfolio as Record<string, unknown> | undefined) ?? {};

    let result: Record<string, unknown>;
    try {
      result = await deps.agentService.runPipeline(ctx.eventId, {
        tenantId,
        decisionId,
        operatingMode,
        investorProfile,
        marketAnalysis,
        portfolio,
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

    // Wrap result for SF state with size guard (currently inline-only;
    // throws OutputTooLargeError if >25 KB — file follow-up if observed).
    const wrapped = wrapAgentOutput(result);

    return {
      output: { decisionId, tenantId, agentOutput: wrapped.value },
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
