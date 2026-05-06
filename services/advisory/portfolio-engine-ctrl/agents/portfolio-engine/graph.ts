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

  // 4. Inject operating-mode behavioral envelope so the agent respects mode-specific
  //    allocation rules (Phase 2 — docs/superpowers/specs/2026-05-05-operating-mode-phase-2-design.md).
  //    investor-profile-ctrl wraps `operatingMode` at the top of its Memory record.
  const upstreams = (payload.upstreamOutputs ?? {}) as Record<string, unknown>;
  const investorProfile = (upstreams['investorProfile'] as Record<string, unknown> | undefined) ?? {};
  const operatingMode = (upstreams['operatingMode'] as string)
    ?? (investorProfile['operatingMode'] as string)
    ?? 'BALANCED';
  const modeGuidance: Record<string, string> = {
    CONSERVATIVE: 'OPERATING MODE: CONSERVATIVE. THESE ARE HARD RULES FOR THIS INVOCATION — every clause MUST be honoured exactly. (1) equityWeight MUST be ≤ 0.30 (the rest in fixed income / cash). (2) the largest single EQUITY position (max targetWeight across allocations whose assetClass is EQUITY) MUST be ≤ 0.10 — bond and cash positions may be larger. (3) allocations.length MUST be between 3 and 5 inclusive. (4) Prefer broad-market ETFs over single names. (5) Prioritise capital preservation over growth. Producing equityWeight > 0.30, an equity position > 10%, or fewer than 3 / more than 5 positions is a HARD FAILURE.',
    BALANCED: 'OPERATING MODE: BALANCED. THESE ARE HARD RULES FOR THIS INVOCATION — every clause MUST be honoured exactly. (1) equityWeight MUST be in [0.50, 0.70]. (2) the largest single EQUITY position (max targetWeight across allocations whose assetClass is EQUITY) MUST be ≤ 0.15 — bond and cash positions may be larger. (3) allocations.length MUST be between 5 and 8 inclusive. (4) Mix broad ETFs with measured sector tilts. (5) Balance growth and stability. Producing equityWeight outside [0.50, 0.70], an equity position > 15%, or fewer than 5 / more than 8 positions is a HARD FAILURE.',
    AGGRESSIVE: 'OPERATING MODE: AGGRESSIVE. THESE ARE HARD RULES FOR THIS INVOCATION — every clause MUST be honoured exactly. (1) equityWeight MUST be in [0.70, 0.90]. (2) the largest single EQUITY position (max targetWeight across allocations whose assetClass is EQUITY) MUST be ≤ 0.25 — bond and cash positions may be larger. (3) allocations.length MUST be between 6 and 12 inclusive. (4) Sector and thematic concentrations allowed. (5) Prioritise long-term growth and accept higher volatility. Producing equityWeight outside [0.70, 0.90], an equity position > 25%, or fewer than 6 / more than 12 positions is a HARD FAILURE.',
  };
  const modeContext = `\n\n${modeGuidance[operatingMode] ?? modeGuidance['BALANCED']}\n` +
    `Reflect adherence in your output: PortfolioConstruction.equityWeight, PortfolioConstruction.riskMetrics.largestPositionWeight, allocations.length must all fall within the envelope above. ` +
    `Each allocation MUST include assetClass (EQUITY | FIXED_INCOME | REIT | COMMODITY | CASH | CRYPTO | OTHER) so the downstream pipeline can derive equity weight from individual positions. ` +
    `Compute equityWeight as the sum of targetWeight across allocations whose assetClass is EQUITY; compute riskMetrics.largestPositionWeight as the maximum targetWeight across allocations whose assetClass is EQUITY (NOT across all allocations).`;

  // 5. Invoke orchestrator (parallel: portfolio-construction + rebalance-planner)
  const enrichedInput = `Decision ${payload.decisionId} context: ${seed}` + modeContext + kbContext + upstreamContext + toolContext;
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

  // 5. Persist to memory — Phase β (Spec 4, 2026-05-06): only write when every
  // agent's wave-node entry is `ok: true`. A partial-degraded cycle no longer
  // poisons AgentCore Memory for downstream agents. The discriminant is
  // stripped before writing because Memory consumers expect raw outputs.
  if (!('serviceUnavailable' in result)) {
    const entries = Object.entries(result);
    const allOk = entries.every(
      ([, v]) => typeof v === 'object' && v !== null && (v as { ok?: boolean }).ok === true,
    );
    if (allOk) {
      const stripped = Object.fromEntries(
        entries.map(([k, v]) => [k, (v as { output: Record<string, unknown> }).output]),
      );
      await session.writeAgentOutput(stripped);
    }
  }

  return result;
}

export { graph };
