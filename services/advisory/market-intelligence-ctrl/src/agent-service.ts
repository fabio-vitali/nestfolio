import {
  resolveAgentRuntimeTarget,
  dispatchAgentInvocation,
  assertOrchestratorOutput,
  DegradedAgentOutputError,
  type AgentNodeResult,
  type MemoryClient,
} from '@nestfolio/agent-orchestrator';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { buildCdcItem, type RequestContext } from '@nestfolio/event-processor';
import type { MarketAnalysisResult } from './domain';

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

const LOCK_TTL_SECONDS = 3600;

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

      try {
        await deps.docClient.send(new PutCommand({
          TableName: deps.tableName,
          Item: buildCdcItem('AgentInvocation',
            { pk: `DECISION#${decisionId}`, sk },
            ctx,
            { invocationId: eventId, decisionId, agentName: 'market-research', status: 'IN_PROGRESS', startedAt, ttl },
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
      const result = await dispatchAgentInvocation<Record<string, AgentNodeResult>>(target, {
        tenantId,
        decisionId,
        upstreamOutputs: (subject.upstreamOutputs ?? {}) as Record<string, unknown>,
      });

      // Phase β (Spec 4, 2026-05-06): discriminant check — fail loudly on any
      // degraded wave-node entry. First time this service has had any guard
      // (legacy code did `result.signals ?? []` which silently passed through
      // a degraded empty fallback as success).
      //
      // Iterate only EXPECTED agent keys. The graph state also carries `input`
      // (a string) and other LangGraph metadata that we must NOT treat as a
      // discriminant.
      const expectedAgentKeys = ['market-research'] as const;
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

      // Phase γ (Spec 4, 2026-05-06): first time this service has had a
      // library-level empty-output guard. Surfaces a degraded structured
      // output as EmptyAgentResponseError instead of silently passing an
      // empty `signals` array through to the consumer.
      assertOrchestratorOutput(
        result,
        ['market-research'],
        { decisionId, agent: 'market-intelligence' },
      );

      const marketResearch = (result['market-research'] as { ok: true; output: Record<string, unknown> }).output;

      // Phase B (inter-agent-state-handoff-sf-vs-memory): emit one long-term
      // event after successful structured-output validation. Bedrock's
      // SEMANTIC_MEMORY strategy on /market-intelligence-ctrl/{tenantId}/
      // signals extracts market signals across decision cycles. Best-effort —
      // emitLongTermEvent catches + logs on SDK failure.
      await deps.memoryClient
        .openDecisionSession(tenantId, decisionId)
        .emitLongTermEvent({
          namespace: 'signals',
          payload: { marketResearch },
        });

      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

      await deps.docClient.send(new PutCommand({
        TableName: deps.tableName,
        Item: buildCdcItem('AgentInvocation',
          { pk: `DECISION#${decisionId}`, sk },
          ctx,
          { invocationId: eventId, decisionId, agentName: 'market-research', status: 'COMPLETED', startedAt, completedAt, durationMs },
        ),
      }));

      return {
        decisionId,
        signals: (marketResearch['signals'] as unknown[]) ?? [],
        tickersMentioned: (marketResearch['tickersMentioned'] as string[]) ?? [],
        marketOutlook: (marketResearch['marketOutlook'] as string) ?? '',
        confidenceScore: (marketResearch['confidenceScore'] as number) ?? 0,
        metadata: { durationMs, modelTier: 'sonnet' },
      } satisfies Omit<MarketAnalysisResult, 'metadata'> & { decisionId: string; metadata: { durationMs: number; modelTier: string } };
    },
  };
};
