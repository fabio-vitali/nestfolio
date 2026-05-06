import {
  resolveAgentRuntimeTarget,
  dispatchAgentInvocation,
  DegradedAgentOutputError,
  type AgentNodeResult,
} from '@nestfolio/agent-orchestrator';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { buildCdcItem, type RequestContext } from '@nestfolio/event-processor';
import type { MarketAnalysisResult } from './domain';

export interface AgentServiceDeps {
  readonly docClient: DynamoDBDocumentClient;
  readonly tableName: string;
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
      for (const [k, v] of Object.entries(result)) {
        if (typeof v !== 'object' || v === null || (v as { ok?: boolean }).ok !== true) {
          const reason = (v as { reason?: string })?.reason ?? 'unknown — non-discriminant shape';
          throw new DegradedAgentOutputError({
            decisionId,
            agent: k,
            reason,
            responseKeys: Object.keys(result),
          });
        }
      }

      const marketResearch = (result['market-research'] as { ok: true; output: Record<string, unknown> }).output;

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
