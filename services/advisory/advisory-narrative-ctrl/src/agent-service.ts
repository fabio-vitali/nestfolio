import {
  resolveAgentRuntimeTarget,
  dispatchAgentInvocation,
} from '@nestfolio/agent-orchestrator';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { buildCdcItem, type RequestContext } from '@nestfolio/event-processor';

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
            { invocationId: eventId, decisionId, agentName: 'explainability', status: 'IN_PROGRESS', startedAt, ttl },
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
      // Build upstreamOutputs explicitly from subject fields. The previous
      // `subject.context ?? subject.upstreamOutputs ?? {}` fallback never
      // matched (the handler doesn't set either) so the agent ran with empty
      // input — fixed in Phase 2 of the operating-mode workstream
      // (docs/superpowers/specs/2026-05-05-operating-mode-phase-2-design.md).
      const result = await dispatchAgentInvocation<Record<string, unknown>>(target, {
        tenantId,
        decisionId,
        upstreamOutputs: {
          operatingMode: (subject.operatingMode as string) ?? 'BALANCED',
          investorProfile: subject.investorProfile ?? {},
          marketAnalysis: subject.marketAnalysis ?? {},
          portfolio: subject.portfolio ?? {},
          preferences: subject.preferences ?? [],
          sessionHistory: subject.sessionHistory ?? [],
        },
      });

      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

      await deps.docClient.send(new PutCommand({
        TableName: deps.tableName,
        Item: buildCdcItem('ReasoningOutput',
          { pk: `DECISION#${decisionId}`, sk: `REASONING#${eventId}` },
          ctx,
          { invocationId: eventId, decisionId, ...result, createdAt: completedAt },
        ),
      }));

      await deps.docClient.send(new PutCommand({
        TableName: deps.tableName,
        Item: buildCdcItem('AgentInvocation',
          { pk: `DECISION#${decisionId}`, sk },
          ctx,
          { invocationId: eventId, decisionId, agentName: 'explainability', status: 'COMPLETED', startedAt, completedAt, durationMs },
        ),
      }));

      return { decisionId, ...result, metadata: { durationMs, modelTier: 'sonnet' } };
    },
  };
};
