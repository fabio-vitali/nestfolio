// services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts
import { Annotation, StateGraph } from '@langchain/langgraph';
import {
  createAgentNode,
  withValidation,
  withRetry,
  withFallback,
  createKBClient,
  invokeOrchestrator,
  type AgentInvocation,
  type AgentNodeResult,
  type KBClient,
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

// Phase β (Spec 4, 2026-05-06): the graph state mirrors the createOrchestrator
// `{[agentKey]: AgentNodeResult}` shape so per-service agent-service.ts
// applies a uniform discriminant check across all four advisory services.
const MarketIntelState = Annotation.Root({
  input: Annotation<string>,
  marketResearch: Annotation<AgentNodeResult | undefined>,
});

const compiledGraph = new StateGraph(MarketIntelState)
  .addNode('market-intelligence', async (state) => {
    const result = await agentNode({ input: state.input });
    return { marketResearch: result };
  })
  .addEdge('__start__', 'market-intelligence')
  .addEdge('market-intelligence', '__end__')
  .compile();

function buildKBClient(): KBClient | null {
  const kbId = process.env['KNOWLEDGE_BASE_ID'];
  if (!kbId) return null;
  return createKBClient({ knowledgeBaseId: kbId, region: process.env['AWS_REGION'] ?? 'us-east-1' });
}

export async function invokeMarketResearch(
  payload: AgentInvocation,
  emitter?: TraceEmitter,
): Promise<Record<string, unknown>> {
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

  // 2. Deterministic tool context (market data + instrument universe, in parallel)
  const [marketData, instrumentUniverse] = await Promise.all([
    Promise.resolve(getMarketData()),
    Promise.resolve(getInstrumentUniverse()),
  ]);
  const toolContext = formatToolContext({
    'Current market data': marketData,
    'Instrument universe': instrumentUniverse,
  });

  // 3. Invoke agent with enriched input
  const enrichedInput =
    `Decision ${payload.decisionId} context: ${seed}` +
    kbContext + toolContext;

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

  // Re-shape to the hyphenated agent key the rest of the system expects
  // ('market-research'). The discriminant `{ok, output, ...}` envelope is
  // preserved so agent-service.ts can apply the discriminant check.
  const marketResearch = (result as { marketResearch?: AgentNodeResult }).marketResearch;
  const shaped: Record<string, AgentNodeResult> = {
    'market-research': marketResearch ?? { ok: false, reason: 'graph returned no marketResearch entry', fallback: {} },
  };

  return shaped;
}
