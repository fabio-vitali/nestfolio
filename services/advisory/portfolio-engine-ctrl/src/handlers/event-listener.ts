import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  materializeToTable,
  record,
  NotRetryableError,
  isRetryable,
  type EventPayload,
  type EventContext,
  type WriteIntent,
  requireEnv,
  logger,
} from '@nestfolio/event-processor';
import {
  createMemoryClient,
  createNoOpMemoryClient,
  type MemoryClient,
  UnknownOperatingModeError,
} from '@nestfolio/agent-orchestrator';
import { KB_INGESTION_EVENT_TYPES } from '../domain';
import { createAgentService, DuplicateInvocationError } from '../agent-service';
import {
  AGENT_COMPLETION_PK, AGENT_COMPLETION_SK,
  AGENT_FAILURE_PK, AGENT_FAILURE_SK,
} from '../repositories/agent-completion.repository';

const AGENT_NAME = 'portfolio-engine';

export interface IngressDeps {
  readonly agentService: { runPipeline: (eventId: string, event: Record<string, unknown>) => Promise<Record<string, unknown>> };
  readonly kbIngestionHandler: { ingest: (event: Record<string, unknown>, eventType: string) => Promise<void> };
  readonly memoryClient: MemoryClient;
}

// The event-processor ingestion engine's normalize-handler expects a
// `WriteIntent | WriteIntent[]` (libs/event-processor/src/engine/normalize-handler.ts).
// Returning a wrapper object like `{ output, intents }` made toArray() treat the
// wrapper as a single bogus intent (tag undefined → "intent result success:false"),
// surfaced by Task 19's MarketSnapshot bootstrap on first deploy.
export const createHandlers = (deps: IngressDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<WriteIntent[]>> = {
    CONSTRUCT_PORTFOLIO: async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent[]> => {
      const subject = payload.subject ?? {};
      const tenantId = (subject.tenantId as string) ?? (ctx.tenantId as unknown as string);
      const decisionId = subject.decisionId as string;
      const taskToken = subject.taskToken as string | undefined;

      if (!taskToken) {
        throw new NotRetryableError(
          `CONSTRUCT_PORTFOLIO missing subject.taskToken for decisionId=${decisionId}`,
        );
      }

      // operatingMode is propagated through SF state from the prior
      // InvokeInvestorProfile stage (subject.operatingMode is wired in
      // decision-state-machine.ts via $.agentResults.InvokeInvestorProfile.operatingMode).
      // Reading it from the event subject avoids the >40s AgentCore Memory
      // ListMemoryRecords eventual-consistency window — see
      // docs/backlog/agentcore-memory-list-records-eventual-consistency.md.
      const operatingMode = subject.operatingMode as string | undefined;
      if (!operatingMode) {
        throw new UnknownOperatingModeError({
          decisionId,
          resolutionPath: 'subject.operatingMode (propagated by SF from InvokeInvestorProfile result)',
          availableKeys: Object.keys(subject),
        });
      }

      logger.info('Processing CONSTRUCT_PORTFOLIO', { decisionId, tenantId, eventId: ctx.eventId });

      const session = deps.memoryClient.openDecisionSession(tenantId, decisionId);

      // Long-term recall (returns [] today; Phase B populates).
      const pastRationale = await session.searchLongTermMemory('rationale', 'allocation rationale decisions');

      // Inter-agent ephemeral handoff via SF state. Upstream outputs arrive
      // through subject.{investorProfile, marketAnalysis} (plumbed via
      // SF Parameters from $.agentResults.<Upstream>.agentOutput). No Memory
      // reads for upstream context, no retry sleep.
      const investorProfile = (subject.investorProfile as Record<string, unknown> | undefined) ?? {};
      const marketAnalysis = (subject.marketAnalysis as Record<string, unknown> | undefined) ?? {};

      try {
        const result = await deps.agentService.runPipeline(ctx.eventId, {
          tenantId,
          decisionId,
          operatingMode,
          investorProfile,
          marketAnalysis,
          pastRationale: pastRationale.map(r => r.content),
        });

        return [
          record('AgentInvocation', { decisionId, tenantId, agentName: AGENT_NAME }),
          record(
            'AgentCompletion',
            {
              decisionId,
              tenantId,
              agentName: AGENT_NAME,
              taskToken,
              agentOutput: result,
              completedAt: new Date().toISOString(),
            },
            { pk: AGENT_COMPLETION_PK(decisionId), sk: AGENT_COMPLETION_SK(AGENT_NAME) },
          ),
        ];
      } catch (err) {
        if (err instanceof DuplicateInvocationError) {
          logger.info('Duplicate CONSTRUCT_PORTFOLIO event, skipping', { eventId: ctx.eventId, decisionId });
          return [];
        }
        const error = err as Error;

        // Transient errors (Bedrock throttle, AgentCore maxVms contention, network
        // blips) MUST rethrow so SQS redelivers the same message + same task token
        // after the visibility-timeout. Re-invoking on the same task token IS correct
        // for transient errors — the agent's input hasn't changed; only the resource
        // contention has cleared. Permanent errors (schema mismatch, bad input,
        // agent logic threw) emit AgentFailure → DWC → SendTaskFailure → SF error.
        // Classification uses event-processor's isRetryable() which handles AWS SDK
        // errors including ServiceQuotaExceededException.
        if (isRetryable(error)) {
          logger.warn('Agent run failed with transient error; rethrowing for SQS retry', {
            decisionId,
            eventId: ctx.eventId,
            errorType: error.name,
            errorMessage: error.message,
          });
          throw error;
        }

        logger.error('Agent run failed with permanent error; emitting AgentFailure', {
          decisionId,
          eventId: ctx.eventId,
          errorType: error.name,
          errorMessage: error.message,
        });
        return [
          record(
            'AgentFailure',
            {
              decisionId,
              tenantId,
              agentName: AGENT_NAME,
              taskToken,
              errorType: error.name ?? 'UnknownError',
              errorMessage: error.message,
              failedAt: new Date().toISOString(),
            },
            { pk: AGENT_FAILURE_PK(decisionId), sk: AGENT_FAILURE_SK(AGENT_NAME) },
          ),
        ];
      }
    },
  };

  // KB ingestion events — routed through this listener, delegate to the ingestion handler.
  // No intents to emit; the side-effect happens inside kbIngestionHandler.ingest.
  for (const eventType of KB_INGESTION_EVENT_TYPES) {
    handlers[eventType] = async (payload, ctx) => {
      await deps.kbIngestionHandler.ingest(
        { type: ctx.eventType, subject: payload.subject } as Record<string, unknown>,
        ctx.eventType,
      );
      return [];
    };
  }

  return handlers;
};

// --- Production wiring ---

const TABLE_NAME = requireEnv('TABLE_NAME');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const memoryClient = process.env.MEMORY_ID
  ? createMemoryClient({
      memoryId: process.env.MEMORY_ID,
      region: process.env.AWS_REGION ?? 'us-east-1',
      serviceName: AGENT_NAME,
      namespacePrefix: 'shared-rationale',
    })
  : createNoOpMemoryClient();

const agentService = createAgentService({ docClient, tableName: TABLE_NAME, memoryClient });

// KB ingestion events are routed to a separate Lambda (KBIngestion in the
// stack); the event-listener Lambda receives them via Ingress but delegates
// to the dedicated KB Lambda via EventBridge routing. This stub keeps the
// handler signature symmetric for tests.
const kbIngestionHandler = {
  ingest: async (_event: Record<string, unknown>, _eventType: string) => {
    // Delegated to kb-ingestion-handler Lambda via Ingress routing
  },
};

const deps: IngressDeps = { agentService, kbIngestionHandler, memoryClient };

export const handler = materializeToTable({
  serviceName: 'portfolio-engine-ctrl',
  handlers: createHandlers(deps),
  errorEventType: 'PORTFOLIO_ENGINE_CTRL_FAILED',
});
