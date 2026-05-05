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

    let result: Record<string, unknown>;
    try {
      result = await deps.agentService.runPipeline(ctx.eventId, {
        tenantId,
        decisionId,
        investorProfile: subject.investorProfile ?? subject.context ?? {},
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

    await session.writeAgentOutput(result);

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
