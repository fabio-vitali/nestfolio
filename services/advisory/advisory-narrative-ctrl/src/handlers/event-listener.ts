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
  wrapAgentOutput,
} from '@nestfolio/agent-orchestrator';
import { createAgentService, DuplicateInvocationError } from '../agent-service';
import {
  AGENT_COMPLETION_PK, AGENT_COMPLETION_SK,
  AGENT_FAILURE_PK, AGENT_FAILURE_SK,
} from '../repositories/agent-completion.repository';
import type { NarrativeAgentOutput } from '../domain/contracts';

const AGENT_NAME = 'advisory-narrative';

export interface IngressDeps {
  readonly agentService: { runPipeline: (eventId: string, event: Record<string, unknown>) => Promise<Record<string, unknown>> };
  readonly feedbackCorrelator: { process: (event: Record<string, unknown>) => Promise<void> };
  readonly memoryClient: MemoryClient;
}

// The event-processor ingestion engine's normalize-handler expects a
// `WriteIntent | WriteIntent[]` (libs/event-processor/src/engine/normalize-handler.ts).
// Returning a wrapper object like `{ output, intents }` made toArray() treat the
// wrapper as a single bogus intent (tag undefined → "intent result success:false"),
// surfaced by Task 19's MarketSnapshot bootstrap on first deploy.
export const createHandlers = (deps: IngressDeps) => ({
  GENERATE_NARRATIVE: async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent[]> => {
    const subject = payload.subject ?? {};
    const tenantId = (subject.tenantId as string) ?? (ctx.tenantId as unknown as string);
    const decisionId = subject.decisionId as string;
    const taskToken = subject.taskToken as string | undefined;

    if (!taskToken) {
      throw new NotRetryableError(
        `GENERATE_NARRATIVE missing subject.taskToken for decisionId=${decisionId}`,
      );
    }

    logger.info('Processing GENERATE_NARRATIVE', { decisionId, tenantId, eventId: ctx.eventId });

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

    // Phase B (inter-agent-state-handoff-sf-vs-memory): the previous two
    // retrieval sites (preferences/communication-style + session summaries)
    // merged into one rationale query. Narrative no longer writes to its
    // own preferences namespace; the rationale namespace carries both prior
    // decision narratives and the tone signals a returning narrative agent
    // uses to maintain stylistic consistency.
    const priorNarratives = await session.searchLongTermMemory(
      'rationale',
      'prior decision narratives and communication style',
    );

    // Inter-agent ephemeral handoff: upstream outputs arrive via SF state
    // Parameters from $.agentResults.<Upstream>.agentOutput. No Memory reads,
    // no eventual-consistency wait. Empty/null upstreams are tolerated; the
    // agent input simply has empty objects in those slots (matches the
    // pre-migration Memory-empty behavior).
    const investorProfile = (subject.investorProfile as Record<string, unknown> | undefined) ?? {};
    const marketAnalysis = (subject.marketAnalysis as Record<string, unknown> | undefined) ?? {};
    const portfolio = (subject.portfolio as Record<string, unknown> | undefined) ?? {};

    try {
      const result = await deps.agentService.runPipeline(ctx.eventId, {
        tenantId,
        decisionId,
        operatingMode,
        investorProfile,
        marketAnalysis,
        portfolio,
        priorNarratives: priorNarratives.map(r => r.content),
      });

      // Size guard only — `wrapAgentOutput` throws OutputTooLargeError if
      // the agent output exceeds 25 KB. The wrapped value is no longer
      // returned to SF (handlers must return WriteIntent[]); DWC reads the
      // full result back from the AgentCompletion row via CDC. The wrapper
      // itself is now vestigial — see backlog/an-ctrl-wrap-agent-output-vestigial.md.
      wrapAgentOutput(result);

      return [
        record('AgentInvocation', { decisionId, tenantId, agentName: AGENT_NAME }),
        record(
          'AgentCompletion',
          {
            decisionId,
            tenantId,
            agentName: AGENT_NAME,
            taskToken,
            agentOutput: result as NarrativeAgentOutput,
            completedAt: new Date().toISOString(),
          },
          { pk: AGENT_COMPLETION_PK(decisionId), sk: AGENT_COMPLETION_SK(AGENT_NAME) },
        ),
      ];
    } catch (err) {
      if (err instanceof DuplicateInvocationError) {
        logger.info('Duplicate GENERATE_NARRATIVE event, skipping', { eventId: ctx.eventId, decisionId });
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

  DECISION_FEEDBACK: async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent[]> => {
    logger.info('Processing DECISION_FEEDBACK', { eventType: ctx.eventType });
    await deps.feedbackCorrelator.process({
      type: ctx.eventType,
      subject: payload.subject,
    } as Record<string, unknown>);
    return [];
  },
});

// --- Production wiring ---

const TABLE_NAME = requireEnv('TABLE_NAME');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const feedbackCorrelator = {
  process: async (_event: Record<string, unknown>) => {
    // Delegated to feedback-correlator — invoked inline here
    // In production, this would load from DDB, annotate, and write to S3
  },
};

const memoryClient = process.env.MEMORY_ID
  ? createMemoryClient({
      memoryId: process.env.MEMORY_ID,
      region: process.env.AWS_REGION ?? 'us-east-1',
      serviceName: AGENT_NAME,
      namespacePrefix: 'shared-rationale',
    })
  : createNoOpMemoryClient();

const agentService = createAgentService({ docClient, tableName: TABLE_NAME, memoryClient });

const deps: IngressDeps = { agentService, feedbackCorrelator, memoryClient };

export const handler = materializeToTable({
  serviceName: 'advisory-narrative-ctrl',
  handlers: createHandlers(deps),
  errorEventType: 'ADVISORY_NARRATIVE_CTRL_FAILED',
});
