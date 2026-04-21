// services/advisory/investor-profile-ctrl/agents/investor-profile/graph.ts
import {
  createOrchestrator,
  invokeOrchestrator,
  createKBClient,
  createMemoryClient,
  createNoOpMemoryClient,
  type CompiledGraph,
  type KBClient,
  type MemoryClient,
  type AgentInvocation,
  type ServiceUnavailableResponse,
  type TraceEmitter,
} from '@nestfolio/agent-orchestrator';
import { userGoalsConfig } from '../../src/agents/user-goals.config';
import { riskAssessmentConfig } from '../../src/agents/risk-assessment.config';
import { goalsValidationRule, riskValidationRule } from '../../src/agents/validation';
import { userGoalsFallback, riskAssessmentFallback } from '../../src/agents/fallbacks';
import { InvestorProfileState } from '../../src/agents/state';

const graph: CompiledGraph = createOrchestrator({
  agents: {
    'user-goals': userGoalsConfig,
    'risk-assessment': riskAssessmentConfig,
  },
  waves: [
    { agents: ['user-goals', 'risk-assessment'] },
  ],
  stateAnnotation: InvestorProfileState,
  validationRules: {
    'user-goals': goalsValidationRule,
    'risk-assessment': riskValidationRule,
  },
  fallbacks: {
    'user-goals': userGoalsFallback,
    'risk-assessment': riskAssessmentFallback,
  },
  retryOptions: { maxAttempts: 3 },
});

function buildKBClient(): KBClient | null {
  const kbId = process.env['KNOWLEDGE_BASE_ID'];
  if (!kbId) return null;
  return createKBClient({ knowledgeBaseId: kbId, region: process.env['AWS_REGION'] ?? 'us-east-1' });
}

function buildMemoryClient(): MemoryClient {
  const memoryId = process.env['MEMORY_ID'];
  if (!memoryId) return createNoOpMemoryClient();
  return createMemoryClient({
    memoryId,
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    serviceName: 'investor-profile-ctrl',
  });
}

export async function invokeInvestorProfile(
  payload: AgentInvocation,
  emitter?: TraceEmitter,
): Promise<Record<string, unknown>> {
  const memory = buildMemoryClient();
  const session = memory.openDecisionSession(payload.tenantId, payload.decisionId);
  const kb = buildKBClient();

  const rawInput = JSON.stringify(payload.upstreamOutputs);

  // 1. Retrieve regulatory frameworks from KB
  let kbContext = '';
  if (kb) {
    const kbResults = await kb.retrieve(rawInput, 3);
    if (kbResults.length > 0) {
      kbContext = `\n\nRegulatory context from knowledge base:\n${kbResults.map((r) => r.text).join('\n')}`;
    }
  }

  // 2. Read tenant history from long-term memory
  const tenantHistory = await session.searchLongTermMemory(
    `prior risk assessments for tenant ${payload.tenantId}`,
    3,
  );
  const historyContext = tenantHistory.length > 0
    ? `\n\nTenant history:\n${tenantHistory.map((r) => r.content).join('\n')}`
    : '';

  // 3. Invoke orchestrator (parallel: user-goals + risk-assessment)
  const enrichedInput = rawInput + kbContext + historyContext;
  const result = await invokeOrchestrator(
    graph,
    { input: enrichedInput },
    emitter
      ? {
          agent: 'investor-profile',
          correlationId: payload.decisionId,
          tenantId: payload.tenantId,
          emitter,
        }
      : undefined,
  );

  // Throw on service unavailable so the container emits a 500 via createAgentServer
  if ('serviceUnavailable' in result) {
    const unavailable = result as ServiceUnavailableResponse;
    throw new Error(`Agent orchestrator unavailable: ${unavailable.reason}`);
  }

  // 4. Persist to memory
  await session.writeAgentOutput(result);

  return result;
}

export { graph };
