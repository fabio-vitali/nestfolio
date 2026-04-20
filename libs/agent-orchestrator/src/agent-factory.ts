import { ChatBedrockConverse } from '@langchain/aws';
import type { z } from 'zod';
import type { AgentConfig } from './types';
import type { AgentNodeFn } from './with-validation';

// US cross-region inference profile IDs. Must match advisory-hub's SSM
// parameter values: these Claude 4 models require an inference profile (not a
// base model ID) for on-demand invocation in us-east-1. Using the bare base
// IDs yields a Bedrock ValidationException.
const MODEL_ID_MAP: Record<string, string> = {
  haiku: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  sonnet: 'us.anthropic.claude-sonnet-4-6',
  opus: 'us.anthropic.claude-opus-4-6-v1',
};

export function createAgentNode<T extends z.ZodType>(config: AgentConfig<T>): AgentNodeFn {
  const { modelId, maxTokens, temperature, schema, promptTemplate } = config;

  return async (state, runnableConfig) => {
    const effectiveModelId = state.__escalationTier
      ? MODEL_ID_MAP[state.__escalationTier as string] ?? modelId
      : modelId;

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
