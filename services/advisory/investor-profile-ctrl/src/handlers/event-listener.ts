import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  materializeToTable,
  record,
  update,
  parseSubject,
  type EventPayload,
  type EventContext,
  type WriteIntent,
  requireEnv,
  logger,
} from '@nestfolio/event-processor';
import '../read-model-ownership';
import {
  createMemoryClient,
  createNoOpMemoryClient,
  type MemoryClient,
} from '@nestfolio/agent-orchestrator';
import {
  InvestorProfileUpdatedSchema,
  type InvestorProfileUpdated,
  MandateSchema,
  type Mandate,
} from '@nestfolio/investor-adpt/domain';
import { createAgentService, DuplicateInvocationError } from '../agent-service';
import {
  investorProfileSnapshotPk,
  INVESTOR_PROFILE_SNAPSHOT_SK,
} from '../repositories/investor-profile-snapshot.repository';

export interface IngressDeps {
  readonly agentService: { runPipeline: (eventId: string, event: Record<string, unknown>) => Promise<Record<string, unknown>> };
  readonly memoryClient: MemoryClient;
}

type SourceEventType =
  | 'INVESTOR_PROFILE_UPDATED'
  | 'MANDATE_ISSUED';

// Both trigger subjects are contract-backed (WS-3): INVESTOR_PROFILE_UPDATED →
// InvestorProfileUpdatedSchema, MANDATE_ISSUED → MandateSchema (both re-exported
// cross-domain via @nestfolio/investor-adpt/domain). Both schemas carry
// operatingMode top-level as a required enum, so a missing/invalid value
// poison-pills via ZodError at the parseSubject seam (intended WS-3 behavior) —
// the old UnknownOperatingModeError block is dead and was removed.
type SnapshotSubject = InvestorProfileUpdated | Mandate;

// The event-processor ingestion engine's normalize-handler expects a
// `WriteIntent | WriteIntent[]` (libs/event-processor/src/engine/normalize-handler.ts).
// Returning a wrapper object like `{ output, intents }` made toArray() treat the
// wrapper as a single bogus intent (tag undefined → "intent result success:false"),
// surfaced by Task 19's MarketSnapshot bootstrap on first deploy.
async function runSnapshotAgent(
  deps: IngressDeps,
  subject: SnapshotSubject,
  ctx: EventContext,
  sourceEventType: SourceEventType,
): Promise<WriteIntent[]> {
  // DRY domain subjects carry no tenantId/userId — identity travels in the event
  // context (RequestContext). The snapshot is owned by the tenant principal, so its
  // natural key is (tenantId, userId) with both resolving to ctx.tenantId (preserves
  // the prior `subject.tenantId ?? ctx.tenantId` / `subject.userId ?? tenantId`
  // behavior, where the subject never carried either field).
  const tenantId = ctx.tenantId as unknown as string;
  const userId = tenantId;

  // Both schemas guarantee operatingMode as a required enum — typed read, no fallback.
  const operatingMode = subject.operatingMode;

  logger.info(`Processing ${sourceEventType} for snapshot rebuild`, { tenantId, userId, eventId: ctx.eventId });

  const session = deps.memoryClient.openDecisionSession(tenantId, `snapshot-${ctx.eventId}`);
  const tenantHistory = await session.searchLongTermMemory('preferences', 'investor preferences risk tolerance');

  let result: Record<string, unknown>;
  try {
    result = await deps.agentService.runPipeline(ctx.eventId, {
      tenantId,
      decisionId: `snapshot-${ctx.eventId}`,
      operatingMode,
      investorProfile: subject,
      portfolioState: {},
      tenantHistory: tenantHistory.map((r: { content: unknown }) => r.content),
    });
  } catch (error) {
    if (error instanceof DuplicateInvocationError) {
      logger.info(`Duplicate ${sourceEventType} event, skipping`, { eventId: ctx.eventId });
      return [];
    }
    throw error;
  }

  return [
    record('AgentInvocation', {
      decisionId: `snapshot-${ctx.eventId}`,
      tenantId,
      agentName: 'investor-profile',
    }),
    update(
      'InvestorProfileSnapshot',
      {
        tenantId,
        userId,
        agentOutput: result,
        sourceEventId: ctx.eventId,
        sourceEventType,
        agentInvocationId: ctx.eventId,
      },
      { add: { __version: 1 }, overrides: { pk: investorProfileSnapshotPk(tenantId, userId), sk: INVESTOR_PROFILE_SNAPSHOT_SK } },
    ),
  ];
}

export const createHandlers = (deps: IngressDeps) => ({
  INVESTOR_PROFILE_UPDATED: (p: EventPayload, c: EventContext) =>
    runSnapshotAgent(deps, parseSubject(p, InvestorProfileUpdatedSchema), c, 'INVESTOR_PROFILE_UPDATED'),
  MANDATE_ISSUED: (p: EventPayload, c: EventContext) =>
    runSnapshotAgent(deps, parseSubject(p, MandateSchema), c, 'MANDATE_ISSUED'),
});

// --- Production wiring ---

const TABLE_NAME = requireEnv('TABLE_NAME');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const memoryClient = process.env.MEMORY_ID
  ? createMemoryClient({ memoryId: process.env.MEMORY_ID, region: process.env.AWS_REGION ?? 'us-east-1', serviceName: 'investor-profile' })
  : createNoOpMemoryClient();

const agentService = createAgentService({ docClient, tableName: TABLE_NAME, memoryClient });

const deps: IngressDeps = { agentService, memoryClient };

export const handler = materializeToTable({
  serviceName: 'investor-profile-ctrl',
  handlers: createHandlers(deps),
  errorEventType: 'INVESTOR_PROFILE_CTRL_FAILED',
});
