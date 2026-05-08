import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  resumeStateMachine, record,
  type EventPayload, type EventContext, type WriteIntent,
  requireEnv, logger,
} from '@nestfolio/event-processor';
import { createMemoryClient, createNoOpMemoryClient, type MemoryClient, UnknownOperatingModeError } from '@nestfolio/agent-orchestrator';
import { KB_INGESTION_EVENT_TYPES } from '../domain';
import { createAgentService, DuplicateInvocationError } from '../agent-service';

export interface SfnCallbackDeps {
  readonly agentService: { runPipeline: (eventId: string, event: Record<string, unknown>) => Promise<Record<string, unknown>> };
  readonly kbIngestionHandler: { ingest: (event: Record<string, unknown>, eventType: string) => Promise<void> };
  readonly memoryClient: MemoryClient;
}

export const createHandlers = (deps: SfnCallbackDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<{ output: Record<string, unknown>; intents?: WriteIntent[] }>> = {
    CONSTRUCT_PORTFOLIO: async (payload: EventPayload, ctx: EventContext) => {
      const subject = payload.subject ?? {};
      const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
      const decisionId = subject.decisionId as string;

      logger.info('Processing CONSTRUCT_PORTFOLIO', { decisionId, tenantId });

      const session = deps.memoryClient.openDecisionSession(tenantId, decisionId);

      const [investorRecords, marketRecords, pastRationale] = await Promise.all([
        session.readUpstreamOutput('investor-profile'),
        session.readUpstreamOutput('market-intelligence'),
        session.searchLongTermMemory('allocation rationale decisions'),
      ]);

      // AgentCore Memory has read-after-write eventual consistency on
      // ListMemoryRecords (~10-30s lag observed empirically). Retry with
      // backoff so a freshly-written investor-profile record from the prior
      // SF stage is found before throwing. Tests can short-circuit by setting
      // the MEMORY_READ_RETRY_DELAYS_MS_OVERRIDE env to '0,0,0,0'.
      let investorProfile: Record<string, unknown> = investorRecords[0]?.content
        ? JSON.parse(investorRecords[0].content)
        : {};
      let operatingMode = investorProfile.operatingMode as string | undefined;
      const retryDelays = (process.env.MEMORY_READ_RETRY_DELAYS_MS_OVERRIDE
        ?? '3000,5000,8000,12000')
        .split(',').map((s) => parseInt(s.trim(), 10));
      for (const delay of retryDelays) {
        if (operatingMode) break;
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        const refreshed = await session.readUpstreamOutput('investor-profile');
        investorProfile = refreshed[0]?.content ? JSON.parse(refreshed[0].content) : {};
        operatingMode = investorProfile.operatingMode as string | undefined;
      }
      if (!operatingMode) {
        throw new UnknownOperatingModeError({
          decisionId,
          resolutionPath: "session.readUpstreamOutput('investor-profile')[0].content.operatingMode (after 4 retries)",
          availableKeys: Object.keys(investorProfile),
        });
      }

      let result: Record<string, unknown>;
      try {
        result = await deps.agentService.runPipeline(ctx.eventId, {
          tenantId,
          decisionId,
          operatingMode,
          investorProfile,
          marketAnalysis: marketRecords[0]?.content ? JSON.parse(marketRecords[0].content) : {},
          pastRationale: pastRationale.map(r => r.content),
        });
      } catch (error) {
        if (error instanceof DuplicateInvocationError) {
          logger.info('Duplicate CONSTRUCT_PORTFOLIO event, skipping', { eventId: ctx.eventId, decisionId });
          return { output: { decisionId, tenantId, deduplicated: true } };
        }
        throw error;
      }

      await session.writeAgentOutput(result);

      return {
        output: { decisionId, tenantId },
        intents: [record('AgentInvocation', { decisionId, tenantId, agentName: 'portfolio-engine' })],
      };
    },
  };

  // KB ingestion events — routed through this listener, delegate to the ingestion handler
  for (const eventType of KB_INGESTION_EVENT_TYPES) {
    handlers[eventType] = async (payload, ctx) => {
      await deps.kbIngestionHandler.ingest(
        { type: ctx.eventType, subject: payload.subject } as Record<string, unknown>,
        ctx.eventType,
      );
      return { output: { eventType: ctx.eventType, status: 'ingested' } };
    };
  }

  return handlers;
};

// --- Production wiring ---

const TABLE_NAME = requireEnv('TABLE_NAME');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const agentService = createAgentService({ docClient, tableName: TABLE_NAME });

const kbIngestionHandler = {
  ingest: async (_event: Record<string, unknown>, _eventType: string) => {
    // Delegated to kb-ingestion-handler Lambda via Ingress routing
  },
};

const memoryClient = process.env.MEMORY_ID
  ? createMemoryClient({ memoryId: process.env.MEMORY_ID, region: process.env.AWS_REGION ?? 'us-east-1', serviceName: 'portfolio-engine' })
  : createNoOpMemoryClient();

const deps: SfnCallbackDeps = { agentService, kbIngestionHandler, memoryClient };

export const handler = resumeStateMachine({
  serviceName: 'portfolio-engine-ctrl',
  handlers: createHandlers(deps),
  errorEventType: 'PORTFOLIO_ENGINE_CTRL_FAILED',
});
