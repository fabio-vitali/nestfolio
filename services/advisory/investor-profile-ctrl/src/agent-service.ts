import { createOrchestrator, invokeOrchestrator, resolveAgentRuntimeUrl, invokeRemoteRuntime } from '@nestfolio/agent-orchestrator';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { buildCdcItem, type RequestContext } from '@nestfolio/event-processor';
import { userGoalsConfig } from './agents/user-goals.config';
import { riskAssessmentConfig } from './agents/risk-assessment.config';
import { InvestorProfileState } from './agents/state';

export interface AgentServiceDeps {
  readonly docClient: DynamoDBDocumentClient;
  readonly tableName: string;
}

export const createAgentService = (deps: AgentServiceDeps) => {
  const orchestrator = createOrchestrator({
    agents: {
      'user-goals': userGoalsConfig,
      'risk-assessment': riskAssessmentConfig,
    },
    waves: [
      { agents: ['user-goals', 'risk-assessment'] },
    ],
    stateAnnotation: InvestorProfileState,
  });

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
          { invocationId, decisionId, status: 'IN_PROGRESS', startedAt },
        ),
      }));

      let result: Record<string, unknown>;
      const runtimeUrl = await resolveAgentRuntimeUrl();
      if (runtimeUrl) {
        result = await invokeRemoteRuntime(runtimeUrl, {
          tenantId, decisionId,
          investorProfile: subject.investorProfile ?? subject.context ?? {},
          portfolioState: subject.portfolioState ?? {},
        });
      } else {
        result = await invokeOrchestrator(orchestrator, {
          tenantId, decisionId,
          investorProfile: subject.investorProfile ?? subject.context ?? {},
          portfolioState: subject.portfolioState ?? {},
        }) as Record<string, unknown>;
      }

      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

      await deps.docClient.send(new PutCommand({
        TableName: deps.tableName,
        Item: buildCdcItem('AgentInvocation',
          { pk: `DECISION#${decisionId}`, sk: `INV#${invocationId}` },
          ctx,
          { invocationId, decisionId, status: 'COMPLETED', startedAt, completedAt, durationMs },
        ),
      }));

      return {
        decisionId,
        goals: result['user-goals'] ?? {},
        risk: result['risk-assessment'] ?? {},
        metadata: { durationMs, modelTiers: ['haiku', 'opus'] },
      };
    },
  };
};
