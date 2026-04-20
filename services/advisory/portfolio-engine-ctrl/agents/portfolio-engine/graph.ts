// services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts
import {
  createOrchestrator,
  invokeOrchestrator,
  createKBClient,
  createMemoryClient,
  createNoOpMemoryClient,
  type AgentInvocation,
  type CompiledGraph,
  type KBClient,
  type MemoryClient,
  type TraceEmitter,
} from '@nestfolio/agent-orchestrator';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createPortfolioLookup } from '../../src/agents/tools/portfolio-lookup';
import { formatToolContext } from '../../src/agents/tools/format-context';
import { portfolioConstructionConfig } from '../../src/agents/portfolio-construction.config';
import { rebalancePlannerConfig } from '../../src/agents/rebalance-planner.config';
import { portfolioValidationRule, rebalanceValidationRule } from '../../src/agents/validation';
import { portfolioConstructionFallback, rebalancePlannerFallback } from '../../src/agents/fallbacks';
import { PortfolioEngineState } from '../../src/agents/state';

const graph: CompiledGraph = createOrchestrator({
  agents: {
    'portfolio-construction': portfolioConstructionConfig,
    'rebalance-planner': rebalancePlannerConfig,
  },
  waves: [
    { agents: ['portfolio-construction', 'rebalance-planner'] },
  ],
  stateAnnotation: PortfolioEngineState,
  validationRules: {
    'portfolio-construction': portfolioValidationRule,
    'rebalance-planner': rebalanceValidationRule,
  },
  fallbacks: {
    'portfolio-construction': portfolioConstructionFallback,
    'rebalance-planner': rebalancePlannerFallback,
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
    serviceName: 'portfolio-engine-ctrl',
  });
}

function buildTools() {
  const tableName = process.env['TABLE_NAME'];
  if (!tableName) throw new Error('TABLE_NAME is required for portfolio-engine tools');
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return {
    portfolioLookup: createPortfolioLookup({ docClient, tableName }),
  };
}

const tools = buildTools();

export async function invokePortfolioEngine(
  payload: AgentInvocation,
  emitter?: TraceEmitter,
): Promise<Record<string, unknown>> {
  const memory = buildMemoryClient();
  const session = memory.openDecisionSession(payload.tenantId, payload.decisionId);
  const kb = buildKBClient();

  // 1. Retrieve fund/instrument data from KB
  const seed = JSON.stringify(payload.upstreamOutputs);
  let kbContext = '';
  if (kb) {
    const kbResults = await kb.retrieve(seed, 5);
    if (kbResults.length > 0) {
      kbContext = `\n\nFund & instrument data from knowledge base:\n${kbResults.map((r) => r.text).join('\n')}`;
    }
  }

  // 2. Read upstream context
  const upstreamRecords = await session.readUpstreamOutput('advisory-ctrl');
  const upstreamContext = upstreamRecords.length > 0
    ? `\n\nUpstream context:\n${upstreamRecords.map((r) => r.content).join('\n')}`
    : '';

  // 3. Deterministic tool context (portfolio snapshot)
  const portfolioSnapshot = await tools.portfolioLookup({ tenantId: payload.tenantId });
  const toolContext = formatToolContext({ 'Portfolio snapshot': portfolioSnapshot });

  // 4. Invoke orchestrator (parallel: portfolio-construction + rebalance-planner)
  const enrichedInput = `Decision ${payload.decisionId} context: ${seed}` + kbContext + upstreamContext + toolContext;
  const result = await invokeOrchestrator(
    graph,
    { input: enrichedInput },
    emitter
      ? {
          agent: 'portfolio-engine',
          correlationId: payload.decisionId,
          tenantId: payload.tenantId,
          emitter,
        }
      : undefined,
  );

  // 5. Persist to memory
  if (!('serviceUnavailable' in result)) {
    await session.writeAgentOutput(result);
  }

  return result;
}

export { graph };
