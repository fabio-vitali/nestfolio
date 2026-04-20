import {
  resolveAgentRuntimeTarget,
  dispatchAgentInvocation,
} from '@nestfolio/agent-orchestrator';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { buildCdcItem, type RequestContext } from '@nestfolio/event-processor';

export interface AgentServiceDeps {
  readonly docClient: DynamoDBDocumentClient;
  readonly tableName: string;
}

export const createAgentService = (deps: AgentServiceDeps) => {
  return {
    runPipeline: async (event: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const invocationId = randomUUID();
      const startedAt = new Date().toISOString();
      const subject = (event.subject ?? event) as Record<string, unknown>;
      const ctx = (event.context ?? subject) as RequestContext;
      const decisionId = subject.decisionId as string;
      const tenantId = ctx.tenantId;

      await deps.docClient.send(new PutCommand({
        TableName: deps.tableName,
        Item: buildCdcItem('AgentInvocation',
          { pk: `DECISION#${decisionId}`, sk: `INV#${invocationId}` },
          ctx,
          { invocationId, decisionId, agentName: 'explainability', status: 'IN_PROGRESS', startedAt },
        ),
      }));

      const target = await resolveAgentRuntimeTarget();
      const result = await dispatchAgentInvocation<Record<string, unknown>>(target, {
        tenantId,
        decisionId,
        upstreamOutputs: (subject.context ?? subject.upstreamOutputs ?? {}) as Record<string, unknown>,
      });

      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

      await deps.docClient.send(new PutCommand({
        TableName: deps.tableName,
        Item: buildCdcItem('ReasoningOutput',
          { pk: `DECISION#${decisionId}`, sk: `REASONING#${invocationId}` },
          ctx,
          { invocationId, decisionId, ...result, createdAt: completedAt },
        ),
      }));

      await deps.docClient.send(new PutCommand({
        TableName: deps.tableName,
        Item: buildCdcItem('AgentInvocation',
          { pk: `DECISION#${decisionId}`, sk: `INV#${invocationId}` },
          ctx,
          { invocationId, decisionId, agentName: 'explainability', status: 'COMPLETED', startedAt, completedAt, durationMs },
        ),
      }));

      return { decisionId, ...result, metadata: { durationMs, modelTier: 'sonnet' } };
    },
  };
};
