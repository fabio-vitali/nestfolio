import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  materializeToTable,
  record,
  update,
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
import { createAgentService, DuplicateInvocationError } from '../agent-service';
import {
  marketSnapshotPk,
  MARKET_SNAPSHOT_SK,
} from '../repositories/market-snapshot.repository';

export interface IngressDeps {
  readonly agentService: { runPipeline: (eventId: string, event: Record<string, unknown>) => Promise<Record<string, unknown>> };
  // Retained — not used directly by runMarketAgent (the snapshot writer is
  // region-scoped and has no tenant/decision identity for a Memory session).
  // Passed to agentService internally for Memory persistence via
  // emitLongTermEvent after agent invocation (see agent-service.ts).
  readonly memoryClient: MemoryClient;
}

type Tier = 'fast' | 'slow';

// The event-processor ingestion engine's normalize-handler expects a
// `WriteIntent | WriteIntent[]` (libs/event-processor/src/engine/normalize-handler.ts).
// Returning a wrapper object like `{ output, intents }` made toArray() treat the
// wrapper as a single bogus intent (tag undefined → "intent result success:false"),
// surfaced by Task 19's MarketSnapshot bootstrap on first deploy.
async function runMarketAgent(
  deps: IngressDeps,
  payload: EventPayload,
  ctx: EventContext,
  tier: Tier,
): Promise<WriteIntent[]> {
  const subject = (payload.subject ?? {}) as Record<string, unknown>;
  const region = (subject.region as string | undefined)
    ?? process.env.AWS_REGION
    ?? 'us-east-1';

  logger.info(`Processing ${ctx.eventType} for MarketSnapshot rebuild`, {
    region,
    tier,
    eventId: ctx.eventId,
  });

  // agent-service.runPipeline + invokeAgentCore build `runtimeSessionId = ${tenantId}/${decisionId}`,
  // which Bedrock AgentCore requires to be >= 33 chars. Region-scoped snapshot rebuilds have no
  // natural decisionId, so synthesize one from the eventId (UUID, ~36 chars). tenantId 'SYSTEM' is
  // the convention used by scheduled-tick + bootstrap envelopes.
  const decisionId = `snapshot-${ctx.eventId}`;
  const tenantId = (ctx.tenantId as string | undefined) ?? 'SYSTEM';

  let result: Record<string, unknown>;
  try {
    result = await deps.agentService.runPipeline(ctx.eventId, {
      subject: { region, decisionId },
      context: { tenantId, userId: 'SYSTEM', region },
    });
  } catch (error) {
    if (error instanceof DuplicateInvocationError) {
      logger.info(`Duplicate ${ctx.eventType} event, skipping`, { eventId: ctx.eventId });
      return [];
    }
    throw error;
  }

  const now = new Date().toISOString();
  const intents: WriteIntent[] = [
    record('AgentInvocation', {
      decisionId: `snapshot-${ctx.eventId}`,
      agentName: 'market-intelligence',
    }),
  ];

  if (tier === 'slow') {
    // Slow-tier full rebuild. The regional MarketSnapshot row is long-lived
    // (one row per region, recurring 15-min tick forever) so MUST upsert.
    // `update()` without an explicit condition is a DDB UpdateItem upsert
    // (creates if missing, overwrites SET fields if present) — the natural
    // primitive for continuous projection. Previously used `record()` which
    // is create-only (`attribute_not_exists(pk)`); after the bootstrap tick,
    // every subsequent tick CCFEx'd silently — observed as ~95 errors/day
    // in production-dev 2026-05-28.
    intents.push(
      update(
        'MarketSnapshot',
        {
          region,
          agentOutput: result,
          slowComponentsAt: now,
          fastComponentsAt: now,
          sourceEventIds: [ctx.eventId],
          updatedAt: now,
        },
        { overrides: { pk: marketSnapshotPk(region), sk: MARKET_SNAPSHOT_SK } },
      ),
    );
  } else {
    // Fast-tier partial refresh. NOTE on `sourceEventIds`: the plan calls for
    // appending to a ring buffer (last 20), but `update()` does not natively
    // implement DDB `list_append`. Accepted overwrite semantics per the plan
    // footer Open Question — each fast-tier rebuild stores only the latest
    // source event id. A future iteration can add list-append support to the
    // update intent if the ring buffer becomes required for observability.
    intents.push(
      update(
        'MarketSnapshot',
        {
          region,
          agentOutput: result,
          fastComponentsAt: now,
          updatedAt: now,
          sourceEventIds: [ctx.eventId],
        },
        { overrides: { pk: marketSnapshotPk(region), sk: MARKET_SNAPSHOT_SK } },
      ),
    );
  }

  return intents;
}

export const createHandlers = (deps: IngressDeps) => ({
  YAHOO_FINANCE_UPDATED:        (p: EventPayload, c: EventContext) => runMarketAgent(deps, p, c, 'fast'),
  MARKETWATCH_UPDATED:          (p: EventPayload, c: EventContext) => runMarketAgent(deps, p, c, 'fast'),
  SEC_8K_FILED:                 (p: EventPayload, c: EventContext) => runMarketAgent(deps, p, c, 'fast'),
  FRED_INDICATORS_UPDATED:      (p: EventPayload, c: EventContext) => runMarketAgent(deps, p, c, 'fast'),
  ALPHA_VANTAGE_NEWS_UPDATED:   (p: EventPayload, c: EventContext) => runMarketAgent(deps, p, c, 'fast'),
  MARKET_SNAPSHOT_REFRESH_TICK: (p: EventPayload, c: EventContext) => runMarketAgent(deps, p, c, 'slow'),
});

// --- Production wiring ---

const TABLE_NAME = requireEnv('TABLE_NAME');

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const memoryClient = process.env.MEMORY_ID
  ? createMemoryClient({ memoryId: process.env.MEMORY_ID, region: process.env.AWS_REGION ?? 'us-east-1', serviceName: 'market-intelligence' })
  : createNoOpMemoryClient();

const agentService = createAgentService({ docClient, tableName: TABLE_NAME, memoryClient });

const deps: IngressDeps = { agentService, memoryClient };

export const handler = materializeToTable({
  serviceName: 'market-intelligence-ctrl',
  handlers: createHandlers(deps),
  errorEventType: 'MARKET_INTELLIGENCE_CTRL_FAILED',
});
