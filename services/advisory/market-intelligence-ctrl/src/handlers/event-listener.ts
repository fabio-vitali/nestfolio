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
  readonly memoryClient: MemoryClient;
}

export const createHandlers = (deps: SfnCallbackDeps) => ({
  ANALYZE_MARKET: async (payload: EventPayload, ctx: EventContext) => {
    const subject = payload.subject ?? {};
    const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
    const decisionId = subject.decisionId as string;

    logger.info('Processing ANALYZE_MARKET', { decisionId, tenantId });

    const session = deps.memoryClient.openDecisionSession(tenantId, decisionId);
    const tenantHistory = await session.searchLongTermMemory('market signals sector trends');

    const result = await deps.agentService.runPipeline({
      tenantId,
      decisionId,
      tenantHistory: tenantHistory.map(r => r.content),
    });

    await session.writeAgentOutput(result);

    return {
      output: { decisionId, tenantId },
      intents: [record('AgentInvocation', { decisionId, tenantId, agentName: 'market-intelligence' })],
    };
  },
});

// --- Production wiring ---

const TABLE_NAME = requireEnv('TABLE_NAME');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const agentService = createAgentService({ docClient, tableName: TABLE_NAME });

const memoryClient = process.env.MEMORY_ID
  ? createMemoryClient({ memoryId: process.env.MEMORY_ID, region: process.env.AWS_REGION ?? 'us-east-1', serviceName: 'market-intelligence' })
  : createNoOpMemoryClient();

const deps: SfnCallbackDeps = { agentService, memoryClient };

export const handler = resumeStateMachine({
  serviceName: 'market-intelligence-ctrl',
  handlers: createHandlers(deps),
  errorEventType: 'MARKET_INTELLIGENCE_CTRL_FAILED',
});
