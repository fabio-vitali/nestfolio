import { ChatBedrockConverse } from '@langchain/aws';
import type { z } from 'zod';
import type { AgentConfig, ModelTier } from './types';
import type { AgentNodeFn } from './with-validation';

// US cross-region inference profile IDs. Must match advisory-hub's SSM
// parameter values: these Claude 4 models require an inference profile (not a
// base model ID) for on-demand invocation in us-east-1. Using the bare base
// IDs yields a Bedrock ValidationException.
const MODEL_ID_MAP: Record<ModelTier, string> = {
  haiku: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  sonnet: 'us.anthropic.claude-sonnet-4-6',
  opus: 'us.anthropic.claude-opus-4-6-v1',
};

const TIER_ORDER: readonly ModelTier[] = ['haiku', 'sonnet', 'opus'];

function detectTier(modelId: string): ModelTier | null {
  if (modelId.includes('haiku')) return 'haiku';
  if (modelId.includes('sonnet')) return 'sonnet';
  if (modelId.includes('opus')) return 'opus';
  return null;
}

// Temporary cost-cap downgrade. Driven by AGENT_MODEL_OVERRIDE env var, set
// per deploy via `cdk deploy --context agentModelOverride=haiku`. Two rules:
//   (a) Opus sites are EXEMPT — they were chosen deliberately for
//       structured-output reliability against their Zod schemas.
//   (b) Override never RAISES a tier. Escalation logic via __escalationTier
//       remains the only mechanism that bumps quality up.
function applyOverride(modelId: string): string {
  const target = process.env['AGENT_MODEL_OVERRIDE'] as ModelTier | undefined;
  if (!target || !TIER_ORDER.includes(target)) return modelId;
  const currentTier = detectTier(modelId);
  if (!currentTier) return modelId;
  if (currentTier === 'opus') return modelId;
  const targetIdx = TIER_ORDER.indexOf(target);
  const currentIdx = TIER_ORDER.indexOf(currentTier);
  if (targetIdx >= currentIdx) return modelId;
  return MODEL_ID_MAP[target];
}

export function createAgentNode<T extends z.ZodType>(config: AgentConfig<T>): AgentNodeFn {
  const { modelId, maxTokens, temperature, schema, promptTemplate } = config;

  return async (state, runnableConfig) => {
    const effectiveModelId = state.__escalationTier
      ? MODEL_ID_MAP[state.__escalationTier as ModelTier] ?? modelId
      : applyOverride(modelId);

    const llm = new ChatBedrockConverse({
      model: effectiveModelId,
      maxTokens,
      temperature,
      region: 'us-east-1',
    });

    const structured = llm.withStructuredOutput(schema as any);
    const input = typeof state.input === 'string' ? state.input : JSON.stringify(state);
    const prompt = promptTemplate.replace('{input}', input);
    // Forward RunnableConfig so LangChain propagates the AgentTracer's callbacks
    // (installed by invokeOrchestrator via graph.invoke(input, {callbacks: [...]}))
    // down to the LLM call. Without this, handleLLMStart/End never fire and
    // envelope.llmCalls stays empty.
    const result = await structured.invoke(prompt, runnableConfig);
    return result as Record<string, unknown>;
  };
}
