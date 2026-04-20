import {
  createOrchestrator,
  invokeOrchestrator,
  createMemoryClient,
  createNoOpMemoryClient,
  type CompiledGraph,
  type MemoryClient,
  type AgentInvocation,
} from '@nestfolio/agent-orchestrator';
import { AGENT_CONFIGS, DECISION_LIFECYCLE_WAVES } from '../../src/agents/config';
import { VALIDATION_RULES } from '../../src/agents/validation';
import { FALLBACK_MAP } from '../../src/agents/fallbacks';
import { DecisionLifecycleState } from '../../src/agents/state';

const graph: CompiledGraph = createOrchestrator({
  agents: AGENT_CONFIGS,
  waves: DECISION_LIFECYCLE_WAVES,
  stateAnnotation: DecisionLifecycleState,
  validationRules: VALIDATION_RULES,
  fallbacks: FALLBACK_MAP,
  retryOptions: { maxAttempts: 3 },
});

function buildMemoryClient(): MemoryClient {
  const memoryId = process.env['MEMORY_ID'];
  if (!memoryId) return createNoOpMemoryClient();
  return createMemoryClient({
    memoryId,
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    serviceName: 'advisory-ctrl',
  });
}

export async function invokeDecisionLifecycle(
  payload: AgentInvocation,
): Promise<Record<string, unknown>> {
  const memory = buildMemoryClient();
  const session = memory.openDecisionSession(payload.tenantId, payload.decisionId);

  // Enrich input with long-term memory context
  const priorDecisions = await session.searchLongTermMemory(
    `prior decisions for tenant ${payload.tenantId}`,
    3,
  );
  const memoryContext =
    priorDecisions.length > 0
      ? `\n\nPrior decision context:\n${priorDecisions.map((r) => r.content).join('\n')}`
      : '';

  const enrichedInput = JSON.stringify(payload.upstreamOutputs) + memoryContext;

  const result = await invokeOrchestrator(
    graph,
    {
      input: enrichedInput,
      tenantId: payload.tenantId,
      decisionId: payload.decisionId,
    },
    {},
  );

  // Persist all agent outputs to memory
  if (!('serviceUnavailable' in result)) {
    await session.writeAgentOutput(result);
  }

  return result;
}
