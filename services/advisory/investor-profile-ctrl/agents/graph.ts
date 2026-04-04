// services/advisory/investor-profile-ctrl/agents/graph.ts
import {
  createOrchestrator,
  invokeOrchestrator,
  createKBClient,
  createMemoryClient,
  createNoOpMemoryClient,
  type CompiledGraph,
  type KBClient,
  type MemoryClient,
} from '@nestfolio/agent-orchestrator';
import { userGoalsConfig } from '../src/agents/user-goals.config';
import { riskAssessmentConfig } from '../src/agents/risk-assessment.config';
import { goalsValidationRule, riskValidationRule } from '../src/agents/validation';
import { userGoalsFallback, riskAssessmentFallback } from '../src/agents/fallbacks';
import { InvestorProfileState } from '../src/agents/state';

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

export async function invokeInvestorProfile(params: {
  tenantId: string;
  decisionId: string;
  input: string;
}): Promise<Record<string, unknown>> {
  const memory = buildMemoryClient();
  const session = memory.openDecisionSession(params.tenantId, params.decisionId);
  const kb = buildKBClient();

  // 1. Retrieve regulatory frameworks from KB
  let kbContext = '';
  if (kb) {
    const kbResults = await kb.retrieve(params.input, 3);
    if (kbResults.length > 0) {
      kbContext = `\n\nRegulatory context from knowledge base:\n${kbResults.map((r) => r.text).join('\n')}`;
    }
  }

  // 2. Read tenant history from long-term memory
  const tenantHistory = await session.searchLongTermMemory(
    `prior risk assessments for tenant ${params.tenantId}`,
    3,
  );
  const historyContext = tenantHistory.length > 0
    ? `\n\nTenant history:\n${tenantHistory.map((r) => r.content).join('\n')}`
    : '';

  // 3. Invoke orchestrator (parallel: user-goals + risk-assessment)
  const enrichedInput = params.input + kbContext + historyContext;
  const result = await invokeOrchestrator(graph, { input: enrichedInput }, {});

  // 4. Persist to memory
  if (!('serviceUnavailable' in result)) {
    await session.writeAgentOutput(result);
  }

  return result;
}

export { graph };
