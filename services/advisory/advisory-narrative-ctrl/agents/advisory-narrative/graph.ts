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

// Phase β (Spec 4, 2026-05-06): the graph state mirrors the createOrchestrator
// `{[agentKey]: AgentNodeResult}` shape so the per-service agent-service.ts
// applies a uniform discriminant check across all four advisory services.
const NarrativeState = Annotation.Root({
  input: Annotation<string>,
  explainability: Annotation<AgentNodeResult | undefined>,
});

const compiledGraph = new StateGraph(NarrativeState)
  .addNode('advisory-narrative', async (state) => {
    const result = await agentNode({ input: state.input });
    return { explainability: result };
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

export async function invokeNarrative(
  payload: AgentInvocation,
  emitter?: TraceEmitter,
): Promise<Record<string, unknown>> {
  const kb = buildKBClient();

  let kbContext = '';
  if (kb) {
    const seed = JSON.stringify(payload.upstreamOutputs);
    const kbResults = await kb.retrieve(seed, 3);
    if (kbResults.length > 0) {
      kbContext = `\n\nKnowledge base context:\n${kbResults.map((r) => r.text).join('\n')}`;
    }
  }

  // Inject operating-mode framing so the explanation tone matches the investor's
  // chosen autonomy envelope (Phase 2 — docs/superpowers/specs/2026-05-05-operating-mode-phase-2-design.md).
  const upstreams = (payload.upstreamOutputs ?? {}) as Record<string, unknown>;
  const investorProfile = (upstreams['investorProfile'] as Record<string, unknown> | undefined) ?? {};
  const operatingMode = (upstreams['operatingMode'] as string)
    ?? (investorProfile['operatingMode'] as string)
    ?? 'BALANCED';
  const narrativeFraming: Record<string, string> = {
    CONSERVATIVE: 'OPERATING MODE: CONSERVATIVE. THESE ARE HARD RULES FOR THIS INVOCATION. Frame the explanation around safety, capital preservation, and downside protection. Address volatility concerns proactively. Prefer reassuring language over growth-thesis language.',
    BALANCED: 'OPERATING MODE: BALANCED. THESE ARE HARD RULES FOR THIS INVOCATION. Frame the explanation around long-term growth tempered by measured risk. Acknowledge both upside and downside scenarios with equal weight.',
    AGGRESSIVE: 'OPERATING MODE: AGGRESSIVE. THESE ARE HARD RULES FOR THIS INVOCATION. Frame the explanation around growth opportunity and conviction. Acknowledge volatility as the cost of higher expected return; do not over-soften.',
  };
  const modeContext = `\n\n${narrativeFraming[operatingMode] ?? narrativeFraming['BALANCED']}\n` +
    `Reflect this framing in Explainability.tone and Explainability.summary.`;

  const enrichedInput =
    `Decision ${payload.decisionId} context: ${JSON.stringify(payload.upstreamOutputs)}` +
    modeContext + kbContext;

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

  // Phase β (Spec 4, 2026-05-06): graph now returns
  // `{ input, explainability: AgentNodeResult }`. Forward only the discriminant
  // shape upstream; agent-service.ts applies the discriminant check.
  const explainability = (result as { explainability?: AgentNodeResult }).explainability;
  const shaped: Record<string, AgentNodeResult> = {
    explainability: explainability ?? { ok: false, reason: 'graph returned no explainability entry', fallback: {} },
  };

  return shaped;
}
