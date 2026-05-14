import {
  resolveAgentRuntimeTarget,
  dispatchAgentInvocation,
  assertOrchestratorOutput,
  DegradedAgentOutputError,
  UnknownOperatingModeError,
  type AgentNodeResult,
  type MemoryClient,
} from '@nestfolio/agent-orchestrator';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { buildCdcItem, type RequestContext } from '@nestfolio/event-processor';

export interface AgentServiceDeps {
  readonly docClient: DynamoDBDocumentClient;
  readonly tableName: string;
  readonly memoryClient: MemoryClient;
}

export class DuplicateInvocationError extends Error {
  readonly eventId: string;
  constructor(eventId: string) {
    super(`Duplicate agent invocation for eventId ${eventId}`);
    this.name = 'DuplicateInvocationError';
    this.eventId = eventId;
  }
}

const LOCK_TTL_SECONDS = 3600; // 1 hour — orphaned IN_PROGRESS locks self-expire

export const createAgentService = (deps: AgentServiceDeps) => {
  return {
    runPipeline: async (eventId: string, event: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const startedAt = new Date().toISOString();
      const subject = (event.subject ?? event) as Record<string, unknown>;
      const ctx = (event.context ?? subject) as RequestContext;
      const decisionId = subject.decisionId as string;
      const tenantId = ctx.tenantId;
      const sk = `INV#${eventId}`;
      const ttl = Math.floor(Date.now() / 1000) + LOCK_TTL_SECONDS;

      // Acquire the invocation lock — atomic via attribute_not_exists.
      // Duplicate events fail this check and short-circuit before invoking AgentCore.
      try {
        await deps.docClient.send(new PutCommand({
          TableName: deps.tableName,
          Item: buildCdcItem('AgentInvocation',
            { pk: `DECISION#${decisionId}`, sk },
            ctx,
            { invocationId: eventId, decisionId, status: 'IN_PROGRESS', startedAt, ttl },
          ),
          ConditionExpression: 'attribute_not_exists(sk)',
        }));
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
          throw new DuplicateInvocationError(eventId);
        }
        throw error;
      }

      const target = await resolveAgentRuntimeTarget();
      // Build upstreamOutputs explicitly from subject fields. Throws
      // UnknownOperatingModeError when operatingMode is missing — replaces the
      // previous silent BALANCED fallback that masked the propagation
      // regression tracked in docs/backlog/operating-mode-shape-empty-proposed-trades.md.
      const operatingMode = subject.operatingMode as string | undefined;
      if (!operatingMode) {
        throw new UnknownOperatingModeError({
          decisionId,
          resolutionPath: 'agent-service.runPipeline → subject.operatingMode',
          availableKeys: Object.keys(subject),
        });
      }
      const result = await dispatchAgentInvocation<Record<string, AgentNodeResult>>(target, {
        tenantId,
        decisionId,
        upstreamOutputs: {
          operatingMode,
          investorProfile: subject.investorProfile ?? {},
          marketAnalysis: subject.marketAnalysis ?? {},
          pastRationale: subject.pastRationale ?? [],
        },
      });

      // Phase β (Spec 4, 2026-05-06): discriminant check — fail loudly on any
      // degraded wave-node entry instead of laundering a static fallback into
      // AgentCore Memory. SF observes a TaskFailure with a clear cause; the
      // legacy two-key empty-response check is replaced by the lib-level
      // assertOrchestratorOutput helper introduced in Phase γ.
      //
      // Iterate only EXPECTED agent keys. The graph state also carries `input`
      // (a string) and other LangGraph metadata that we must NOT treat as a
      // discriminant.
      const expectedAgentKeys = ['portfolio-construction', 'rebalance-planner'] as const;
      for (const k of expectedAgentKeys) {
        const v = result[k];
        if (typeof v !== 'object' || v === null || (v as { ok?: boolean }).ok !== true) {
          const reason = (v as { reason?: string } | undefined)?.reason ?? 'unknown — non-discriminant shape';
          throw new DegradedAgentOutputError({
            decisionId,
            agent: k,
            reason,
            responseKeys: Object.keys(result),
          });
        }
      }

      // Phase γ (Spec 4, 2026-05-06): library-level empty-output guard.
      // assertOrchestratorOutput is the lib hoist of the local check this
      // service used to carry; it now also protects the three other advisory
      // services that previously had no such guard.
      assertOrchestratorOutput(
        result,
        ['portfolio-construction', 'rebalance-planner'],
        { decisionId, agent: 'portfolio-engine' },
      );

      const allocations = (result['portfolio-construction'] as { ok: true; output: Record<string, unknown> }).output;
      const trades = (result['rebalance-planner'] as { ok: true; output: Record<string, unknown> }).output;

      // Phase B (inter-agent-state-handoff-sf-vs-memory): emit one long-term
      // event after successful structured-output validation. Bedrock's
      // SEMANTIC_MEMORY strategy on /portfolio-engine-ctrl/{tenantId}/
      // rationale extracts allocation rationale across decision cycles.
      // Best-effort — emitLongTermEvent catches + logs on SDK failure.
      await deps.memoryClient
        .openDecisionSession(tenantId, decisionId)
        .emitLongTermEvent({
          namespace: 'rationale',
          payload: { allocations, trades, modeUsed: operatingMode },
        });

      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

      // Mark the invocation complete. Unconditional overwrite at the same sk;
      // this drops the ttl so completed records persist indefinitely.
      await deps.docClient.send(new PutCommand({
        TableName: deps.tableName,
        Item: buildCdcItem('AgentInvocation',
          { pk: `DECISION#${decisionId}`, sk },
          ctx,
          { invocationId: eventId, decisionId, status: 'COMPLETED', startedAt, completedAt, durationMs },
        ),
      }));

      return {
        decisionId,
        allocations,
        trades,
        metadata: { durationMs, modelTiers: ['opus', 'sonnet'], modeUsed: operatingMode },
      };
    },
  };
};
