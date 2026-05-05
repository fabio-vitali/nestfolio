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

export class EmptyAgentResponseError extends Error {
  readonly decisionId: string;
  readonly responseKeys: string[];
  constructor(decisionId: string, responseKeys: string[]) {
    super(
      `Agent returned no orchestrator output for decision ${decisionId}; ` +
      `got keys=[${responseKeys.join(',')}]. AgentCore likely accepted the invocation but did not run the agent.`,
    );
    this.name = 'EmptyAgentResponseError';
    this.decisionId = decisionId;
    this.responseKeys = responseKeys;
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
          pastRationale: subject.pastRationale ?? [],
        },
      });

      // AgentCore can return a degraded empty response (202-style ack without
      // running the agent). `?? {}` fallbacks used to swallow that as success,
      // which hid runtime failures (see scenario 12 rebalance-on-drift, 2026-04-21).
      // Require at least one orchestrator output key so the failure surfaces
      // as a SF TaskFailure instead of a silent success with empty trades.
      if (!result['portfolio-construction'] && !result['rebalance-planner']) {
        throw new EmptyAgentResponseError(decisionId, Object.keys(result));
      }

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
        allocations: result['portfolio-construction'] ?? {},
        trades: result['rebalance-planner'] ?? {},
        metadata: { durationMs, modelTiers: ['opus', 'sonnet'] },
      };
    },
  };
};
