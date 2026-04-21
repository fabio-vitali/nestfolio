// services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts
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
import { marketResearchConfig } from '../../src/agents/market-research.config';
import { marketResearchValidationRule } from '../../src/agents/validation';
import { marketResearchFallback } from '../../src/agents/fallbacks';
import { getMarketData } from '../../src/agents/tools/market-data';
import { getInstrumentUniverse } from '../../src/agents/tools/instrument-universe';
import { formatToolContext } from '../../src/agents/tools/format-context';

const agentNode = withFallback(
  withRetry(
    withValidation(createAgentNode(marketResearchConfig), marketResearchValidationRule),
    { maxAttempts: 3, escalationPath: ['sonnet'] },
  ),
  marketResearchFallback,
);

const MarketIntelState = Annotation.Root({
  input: Annotation<string>,
  output: Annotation<Record<string, unknown>>,
});

const compiledGraph = new StateGraph(MarketIntelState)
  .addNode('market-intelligence', async (state) => {
    const result = await agentNode({ input: state.input });
    return { output: result as Record<string, unknown> };
  })
  .addEdge('__start__', 'market-intelligence')
  .addEdge('market-intelligence', '__end__')
  .compile();

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
    serviceName: 'market-intelligence-ctrl',
  });
}

export async function invokeMarketResearch(
  payload: AgentInvocation,
  emitter?: TraceEmitter,
): Promise<Record<string, unknown>> {
  const memory = buildMemoryClient();
  const session = memory.openDecisionSession(payload.tenantId, payload.decisionId);
  const kb = buildKBClient();

  // 1. Retrieve market intelligence from KB (news, sentiment, macro)
  const seed = JSON.stringify(payload.upstreamOutputs);
  let kbContext = '';
  if (kb) {
    const kbResults = await kb.retrieve(seed, 5);
    if (kbResults.length > 0) {
      kbContext = `\n\nMarket intelligence from knowledge base:\n${kbResults.map((r) => r.text).join('\n')}`;
    }
  }

  // 2. Read upstream context (investor profile from advisory-ctrl)
  const upstreamRecords = await session.readUpstreamOutput('advisory-ctrl');
  const upstreamContext = upstreamRecords.length > 0
    ? `\n\nUpstream context:\n${upstreamRecords.map((r) => r.content).join('\n')}`
    : '';

  // 3. Deterministic tool context (market data + instrument universe, in parallel)
  const [marketData, instrumentUniverse] = await Promise.all([
    Promise.resolve(getMarketData()),
    Promise.resolve(getInstrumentUniverse()),
  ]);
  const toolContext = formatToolContext({
    'Current market data': marketData,
    'Instrument universe': instrumentUniverse,
  });

  // 4. Invoke agent with enriched input
  const enrichedInput =
    `Decision ${payload.decisionId} context: ${seed}` +
    kbContext + upstreamContext + toolContext;

  const result = await invokeOrchestrator(
    compiledGraph,
    { input: enrichedInput },
    emitter
      ? {
          agent: 'market-intelligence',
          correlationId: payload.decisionId,
          tenantId: payload.tenantId,
          emitter,
        }
      : undefined,
  );

  if ('serviceUnavailable' in result) {
    throw new Error(`Market-intelligence orchestrator unavailable: ${(result as { reason?: string }).reason ?? 'unknown'}`);
  }
  const output = (result as { output?: Record<string, unknown> }).output ?? {};

  // 5. Persist to memory
  await session.writeAgentOutput(output);

  return output;
}
