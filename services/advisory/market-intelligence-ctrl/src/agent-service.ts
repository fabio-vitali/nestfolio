import { createAgentNode, withRetry, withFallback } from '@nestfolio/agent-orchestrator';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { marketResearchConfig } from './agents/market-research.config';
import type { MarketAnalysisResult } from './domain';

export interface AgentServiceDeps {
  readonly docClient: DynamoDBDocumentClient;
  readonly tableName: string;
}

export const createAgentService = (deps: AgentServiceDeps) => {
  const baseNode = createAgentNode(marketResearchConfig);
  const resilientNode = withFallback(
    withRetry(baseNode, { maxAttempts: 3, escalationPath: ['sonnet'] }),
    async (state) => ({
      ...state,
      signals: [],
      tickersMentioned: [],
      marketOutlook: 'Unable to complete market analysis — fallback engaged',
      confidenceScore: 0,
    }),
  );

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
          agentName: 'market-research',
          status: 'IN_PROGRESS',
          startedAt,
        },
      }));

      const result = await resilientNode({
        tenantId,
        decisionId,
        upstreamOutputs: subject.upstreamOutputs ?? {},
      }) as Record<string, unknown>;

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
          agentName: 'market-research',
          status: 'COMPLETED',
          startedAt,
          completedAt,
          durationMs,
        },
      }));

      return {
        decisionId,
        signals: result.signals ?? [],
        tickersMentioned: result.tickersMentioned ?? [],
        marketOutlook: result.marketOutlook ?? '',
        confidenceScore: result.confidenceScore ?? 0,
        metadata: { durationMs, modelTier: 'sonnet' },
      } satisfies Omit<MarketAnalysisResult, 'metadata'> & { decisionId: string; metadata: { durationMs: number; modelTier: string } };
    },
  };
};
