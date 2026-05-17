import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  materializeToTable,
  record,
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
  | 'MANDATE_ISSUED'
  | 'OPERATING_MODE_CHANGED';

type SnapshotHandlerOutput =
  | { output: { tenantId: string; userId: string; sourceEventType: SourceEventType }; intents: WriteIntent[] }
  | { output: { tenantId: string; userId: string; deduplicated: true } };

async function runSnapshotAgent(
  deps: IngressDeps,
  payload: EventPayload,
  ctx: EventContext,
  sourceEventType: SourceEventType,
): Promise<SnapshotHandlerOutput> {
  const subject = (payload.subject ?? {}) as Record<string, unknown>;
  const tenantId = (subject.tenantId as string | undefined) ?? (ctx.tenantId as unknown as string);
  // userId defaults to tenantId in the precomputation model: an investor
  // profile is owned by the tenant principal, so the snapshot's natural key is
  // (tenantId, userId) with userId === tenantId when the upstream event does
  // not carry an explicit userId field.
  const userId = (subject.userId as string | undefined) ?? tenantId;

  const operatingMode = (subject.operatingMode as string | undefined)
    ?? ((subject.mandate as Record<string, unknown> | undefined)?.operatingMode as string | undefined);

  if (!operatingMode) {
    throw new UnknownOperatingModeError({
      decisionId: `snapshot:${sourceEventType}:${tenantId}:${userId}`,
      resolutionPath: 'subject.operatingMode || subject.mandate.operatingMode',
      availableKeys: Object.keys(subject),
    });
  }

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
      return { output: { tenantId, userId, deduplicated: true } };
    }
    throw error;
  }

  return {
    output: { tenantId, userId, sourceEventType },
    intents: [
      record('AgentInvocation', {
        decisionId: `snapshot-${ctx.eventId}`,
        tenantId,
        agentName: 'investor-profile',
      }),
      record(
        'InvestorProfileSnapshot',
        {
          tenantId,
          userId,
          agentOutput: result,
          sourceEventId: ctx.eventId,
          sourceEventType,
          agentInvocationId: ctx.eventId,
        },
        { pk: investorProfileSnapshotPk(tenantId, userId), sk: INVESTOR_PROFILE_SNAPSHOT_SK },
      ),
    ],
  };
}

export const createHandlers = (deps: IngressDeps) => ({
  INVESTOR_PROFILE_UPDATED: (p: EventPayload, c: EventContext) =>
    runSnapshotAgent(deps, p, c, 'INVESTOR_PROFILE_UPDATED'),
  MANDATE_ISSUED: (p: EventPayload, c: EventContext) =>
    runSnapshotAgent(deps, p, c, 'MANDATE_ISSUED'),
  OPERATING_MODE_CHANGED: (p: EventPayload, c: EventContext) =>
    runSnapshotAgent(deps, p, c, 'OPERATING_MODE_CHANGED'),
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
