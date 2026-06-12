import {
  resolveAgentRuntimeTarget,
  dispatchAgentInvocation,
  assertOrchestratorOutput,
  DegradedAgentOutputError,
  UnknownOperatingModeError,
  type AgentNodeResult,
  type MemoryClient,
} from '@nestfolio/agent-orchestrator';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
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

const LOCK_TTL_SECONDS = 3600;

/**
 * AgentCore gate-rejection error names. These exceptions are raised before a
 * micro-VM is provisioned, so the agent provably did not run and consumed zero
 * tokens. On these the eager IN_PROGRESS idempotency lock is released so an SQS
 * redrive can re-run the agent instead of short-circuiting on the stale lock.
 */
const GATE_REJECTION_ERROR_NAMES = new Set([
  'ServiceQuotaExceededException',
  'ThrottlingException',
]);

export const createAgentService = (deps: AgentServiceDeps) => {
  return {
    runPipeline: async (eventId: string, event: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const startedAt = new Date().toISOString();
      // boundary: SF-direct agent invocation payload — no CDC producer contract
      // (assembled by decision-workflow-ctrl SF). The event.subject ?? event
      // fallback is the canonical tell for this pattern.
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
      // Throws UnknownOperatingModeError when missing — replaces the silent
      // BALANCED fallback that masked the propagation regression tracked in
      // docs/backlog/operating-mode-shape-empty-proposed-trades.md.
      const operatingMode = subject.operatingMode as string | undefined;
      if (!operatingMode) {
        throw new UnknownOperatingModeError({
          decisionId,
          resolutionPath: 'investor-profile-ctrl agent-service.runPipeline → subject.operatingMode',
          availableKeys: Object.keys(subject),
        });
      }
      let result: Record<string, AgentNodeResult>;
      try {
        result = await dispatchAgentInvocation<Record<string, AgentNodeResult>>(target, {
          tenantId,
          decisionId,
          upstreamOutputs: {
            operatingMode,
            investorProfile: subject.investorProfile ?? subject.context ?? {},
            portfolioState: subject.portfolioState ?? {},
          },
        });
      } catch (error: unknown) {
        // On an AgentCore gate rejection (maxVms quota / throttling) the agent
        // provably did not run — release the eager IN_PROGRESS lock so the SQS
        // redrive re-runs it instead of short-circuiting as a DuplicateInvocation.
        // Cost-safe: zero prior execution means no double-charge on re-run.
        if (error instanceof Error && GATE_REJECTION_ERROR_NAMES.has(error.name)) {
          await deps.docClient.send(new DeleteCommand({
            TableName: deps.tableName,
            Key: { pk: `DECISION#${decisionId}`, sk },
          }));
        }
        throw error;
      }

      // Phase β (Spec 4, 2026-05-06): discriminant check — fail loudly on any
      // degraded wave-node entry. First time this service has had any guard
      // (legacy code did `result['user-goals'] ?? {}` which silently passed
      // through a degraded empty fallback as success).
      //
      // Iterate only EXPECTED agent keys. The graph state also carries `input`
      // (a string) and other LangGraph metadata that we must NOT treat as a
      // discriminant.
      const expectedAgentKeys = ['user-goals', 'risk-assessment'] as const;
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
      // empty `goals` / `risk` payload to the SF callback.
      assertOrchestratorOutput(
        result,
        ['user-goals', 'risk-assessment'],
        { decisionId, agent: 'investor-profile' },
      );

      const goals = (result['user-goals'] as { ok: true; output: Record<string, unknown> }).output;
      const risk = (result['risk-assessment'] as { ok: true; output: Record<string, unknown> }).output;

      // Phase B (inter-agent-state-handoff-sf-vs-memory): emit one long-term
      // event after successful structured-output validation. Bedrock's
      // USER_PREFERENCE_MEMORY strategy on /investor-profile-ctrl/{tenantId}/
      // preferences extracts investor preferences across decision cycles.
      // Best-effort — emitLongTermEvent catches + logs on SDK failure.
      await deps.memoryClient
        .openDecisionSession(tenantId, decisionId)
        .emitLongTermEvent({
          namespace: 'preferences',
          payload: { goals, risk },
        });

      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

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
        goals,
        risk,
        metadata: { durationMs, modelTiers: ['haiku', 'sonnet'] },
      };
    },
  };
};
