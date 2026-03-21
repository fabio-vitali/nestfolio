import { createOrchestrator, invokeOrchestrator } from '@nestfolio/agent-orchestrator';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { portfolioConstructionConfig } from './agents/portfolio-construction.config';
import { rebalancePlannerConfig } from './agents/rebalance-planner.config';

export interface AgentServiceDeps {
  readonly docClient: DynamoDBDocumentClient;
  readonly tableName: string;
}

export const createAgentService = (deps: AgentServiceDeps) => {
  const orchestrator = createOrchestrator({
    agents: {
      'portfolio-construction': portfolioConstructionConfig,
      'rebalance-planner': rebalancePlannerConfig,
    },
    waves: [
      { agents: ['portfolio-construction', 'rebalance-planner'] },
    ],
    stateAnnotation: {},
  });

  return {
    runPipeline: async (event: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const invocationId = randomUUID();
      const startedAt = new Date().toISOString();
      const subject = (event.subject ?? event) as Record<string, unknown>;
      const decisionId = subject.decisionId as string;
      const tenantId = subject.tenantId as string;

      await deps.docClient.send(new PutCommand({
        TableName: deps.tableName,
        Item: {
          pk: `DECISION#${decisionId}`,
          sk: `INV#${invocationId}`,
          __typename: 'AgentInvocation',
          invocationId,
          decisionId,
          tenantId,
          status: 'IN_PROGRESS',
          startedAt,
        },
      }));

      const result = await invokeOrchestrator(orchestrator, {
        tenantId,
        decisionId,
        upstreamOutputs: subject.context ?? subject.upstreamOutputs ?? {},
      });

      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

      await deps.docClient.send(new PutCommand({
        TableName: deps.tableName,
        Item: {
          pk: `DECISION#${decisionId}`,
          sk: `INV#${invocationId}`,
          __typename: 'AgentInvocation',
          invocationId,
          decisionId,
          tenantId,
          status: 'COMPLETED',
          startedAt,
          completedAt,
          durationMs,
        },
      }));

      return {
        decisionId,
        allocations: (result as Record<string, unknown>)['portfolio-construction'] ?? {},
        trades: (result as Record<string, unknown>)['rebalance-planner'] ?? {},
        metadata: { durationMs, modelTiers: ['opus', 'sonnet'] },
      };
    },
  };
};
