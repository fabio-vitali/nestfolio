import { Annotation, StateGraph } from '@langchain/langgraph';
import {
  createAgentNode,
  withValidation,
  withRetry,
  withFallback,
  createKBClient,
  createMemoryClient,
  createNoOpMemoryClient,
  invokeOrchestrator,
  type AgentInvocation,
  type KBClient,
  type MemoryClient,
  type TraceEmitter,
} from '@nestfolio/agent-orchestrator';
import { explainabilityConfig } from '../../src/agents/explainability.config';
import { narrativeValidationRule } from '../../src/agents/validation';
import { narrativeFallback } from '../../src/agents/fallbacks';

const agentNode = withFallback(
  withRetry(
    withValidation(
      createAgentNode(explainabilityConfig),
      narrativeValidationRule,
    ),
    { maxAttempts: 2, escalationPath: ['sonnet', 'opus'] },
  ),
  narrativeFallback,
);

const NarrativeState = Annotation.Root({
  input: Annotation<string>,
  output: Annotation<Record<string, unknown>>,
});

const compiledGraph = new StateGraph(NarrativeState)
  .addNode('advisory-narrative', async (state) => {
    const result = await agentNode({ input: state.input });
    return { output: result as Record<string, unknown> };
  })
  .addEdge('__start__', 'advisory-narrative')
  .addEdge('advisory-narrative', '__end__')
  .compile();

function buildKBClient(): KBClient | null {
  const kbId = process.env['KNOWLEDGE_BASE_ID'];
  if (!kbId) return null;
  return createKBClient({
    knowledgeBaseId: kbId,
    region: process.env['AWS_REGION'] ?? 'us-east-1',
  });
}

function buildMemoryClient(): MemoryClient {
  const memoryId = process.env['MEMORY_ID'];
  if (!memoryId) return createNoOpMemoryClient();
  return createMemoryClient({
    memoryId,
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    serviceName: 'advisory-narrative-ctrl',
  });
}

export async function invokeNarrative(
  payload: AgentInvocation,
  emitter?: TraceEmitter,
): Promise<Record<string, unknown>> {
  const memory = buildMemoryClient();
  const session = memory.openDecisionSession(payload.tenantId, payload.decisionId);
  const kb = buildKBClient();

  const upstreamRecords = await session.readUpstreamOutput('advisory-ctrl');
  const upstreamContext = upstreamRecords.length > 0
    ? `\n\nUpstream decision context:\n${upstreamRecords.map((r) => r.content).join('\n')}`
    : '';

  let kbContext = '';
  if (kb) {
    const seed = JSON.stringify(payload.upstreamOutputs);
    const kbResults = await kb.retrieve(seed, 3);
    if (kbResults.length > 0) {
      kbContext = `\n\nKnowledge base context:\n${kbResults.map((r) => r.text).join('\n')}`;
    }
  }

  const enrichedInput =
    `Decision ${payload.decisionId} context: ${JSON.stringify(payload.upstreamOutputs)}` +
    upstreamContext + kbContext;

  const result = await invokeOrchestrator(
    compiledGraph,
    { input: enrichedInput },
    emitter
      ? {
          agent: 'advisory-narrative',
          correlationId: payload.decisionId,
          tenantId: payload.tenantId,
          emitter,
        }
      : undefined,
  );

  if ('serviceUnavailable' in result) {
    throw new Error(`Narrative unavailable: ${result.reason}`);
  }
  const output = (result as { output?: Record<string, unknown> }).output ?? {};

  await session.writeAgentOutput(output);
  return output;
}
