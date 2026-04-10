import { createOrchestrator, invokeOrchestrator } from '@nestfolio/agent-orchestrator';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { portfolioConstructionConfig } from './agents/portfolio-construction.config';
import { rebalancePlannerConfig } from './agents/rebalance-planner.config';
import { PortfolioEngineState } from './agents/state';

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

const LOCK_TTL_SECONDS = 3600; // 1 hour — orphaned IN_PROGRESS locks self-expire

export const createAgentService = (deps: AgentServiceDeps) => {
  const orchestrator = createOrchestrator({
    agents: {
      'portfolio-construction': portfolioConstructionConfig,
      'rebalance-planner': rebalancePlannerConfig,
    },
    waves: [
      { agents: ['portfolio-construction', 'rebalance-planner'] },
    ],
    stateAnnotation: PortfolioEngineState,
  });

  return {
    runPipeline: async (eventId: string, event: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const startedAt = new Date().toISOString();
      const subject = (event.subject ?? event) as Record<string, unknown>;
      const decisionId = subject.decisionId as string;
      const tenantId = subject.tenantId as string;
      const sk = `INV#${eventId}`;
      const ttl = Math.floor(Date.now() / 1000) + LOCK_TTL_SECONDS;

      // Acquire the invocation lock — atomic via attribute_not_exists.
      // Duplicate events fail this check and short-circuit before invoking Bedrock.
      try {
        await deps.docClient.send(new PutCommand({
          TableName: deps.tableName,
          Item: {
            pk: `DECISION#${decisionId}`,
            sk,
            __typename: 'AgentInvocation',
            invocationId: eventId,
            decisionId,
            tenantId,
            status: 'IN_PROGRESS',
            startedAt,
            ttl,
          },
          ConditionExpression: 'attribute_not_exists(sk)',
        }));
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
          throw new DuplicateInvocationError(eventId);
        }
        throw error;
      }

      // Run the agent pipeline (Bedrock orchestration).
      const result = await invokeOrchestrator(orchestrator, {
        tenantId,
        decisionId,
        upstreamOutputs: subject.context ?? subject.upstreamOutputs ?? {},
      });

      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

      // Mark the invocation complete. Unconditional overwrite at the same sk;
      // this drops the ttl so completed records persist indefinitely.
      await deps.docClient.send(new PutCommand({
        TableName: deps.tableName,
        Item: {
          pk: `DECISION#${decisionId}`,
          sk,
          __typename: 'AgentInvocation',
          invocationId: eventId,
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
