import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  resumeStateMachine, record,
  type EventPayload, type EventContext,
  requireEnv, logger,
} from '@nestfolio/event-processor';
import { createMemoryClient, createNoOpMemoryClient, type MemoryClient } from '@nestfolio/agent-orchestrator';
import { createAgentService, DuplicateInvocationError } from '../agent-service';

export interface SfnCallbackDeps {
  readonly agentService: { runPipeline: (eventId: string, event: Record<string, unknown>) => Promise<Record<string, unknown>> };
  readonly memoryClient: MemoryClient;
}

export const createHandlers = (deps: SfnCallbackDeps) => ({
  ANALYZE_INVESTOR_PROFILE: async (payload: EventPayload, ctx: EventContext) => {
    const subject = payload.subject ?? {};
    const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
    const decisionId = subject.decisionId as string;

    logger.info('Processing ANALYZE_INVESTOR_PROFILE', { decisionId, tenantId });

    const session = deps.memoryClient.openDecisionSession(tenantId, decisionId);
    const tenantHistory = await session.searchLongTermMemory('investor preferences risk tolerance');

    // Extract operatingMode from the InvestorProfile payload SF passes via
    // subject.investorProfile (composite InvestorProfile row carries it post-collapse).
    // Default to BALANCED for non-INVESTOR_PROFILE_* triggers (DEPOSIT_DETECTED etc.)
    // where triggerContext is not a profile payload — see
    // docs/superpowers/specs/2026-05-05-operating-mode-phase-2-design.md §Out of scope.
    const investorProfile = (subject.investorProfile as Record<string, unknown> | undefined) ?? {};
    const operatingMode = (investorProfile.operatingMode as string)
      ?? ((investorProfile.mandate as Record<string, unknown> | undefined)?.operatingMode as string)
      ?? 'BALANCED';

    let result: Record<string, unknown>;
    try {
      result = await deps.agentService.runPipeline(ctx.eventId, {
        tenantId,
        decisionId,
        operatingMode,
        investorProfile,
        portfolioState: subject.portfolioState ?? {},
        tenantHistory: tenantHistory.map(r => r.content),
      });
    } catch (error) {
      if (error instanceof DuplicateInvocationError) {
        logger.info('Duplicate ANALYZE_INVESTOR_PROFILE event, skipping', { eventId: ctx.eventId, decisionId });
        return { output: { decisionId, tenantId, deduplicated: true } };
      }
      throw error;
    }

    // Wrap with operatingMode at top level so downstream agents (portfolio-engine,
    // advisory-narrative) read it from Memory via session.readUpstreamOutput('investor-profile').
    await session.writeAgentOutput({ operatingMode, ...result });

    return {
      output: { decisionId, tenantId },
      intents: [record('AgentInvocation', { decisionId, tenantId, agentName: 'investor-profile' })],
    };
  },
});

// --- Production wiring ---

const TABLE_NAME = requireEnv('TABLE_NAME');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const agentService = createAgentService({ docClient, tableName: TABLE_NAME });

const memoryClient = process.env.MEMORY_ID
  ? createMemoryClient({ memoryId: process.env.MEMORY_ID, region: process.env.AWS_REGION ?? 'us-east-1', serviceName: 'investor-profile' })
  : createNoOpMemoryClient();

const deps: SfnCallbackDeps = { agentService, memoryClient };

export const handler = resumeStateMachine({
  serviceName: 'investor-profile-ctrl',
  handlers: createHandlers(deps),
  errorEventType: 'INVESTOR_PROFILE_CTRL_FAILED',
});
