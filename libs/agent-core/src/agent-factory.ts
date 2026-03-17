import { ChatBedrockConverse } from '@langchain/aws';
import type { z } from 'zod';
import type { AgentConfig } from './types';
import type { AgentNodeFn } from './with-validation';

const MODEL_ID_MAP: Record<string, string> = {
  haiku: 'anthropic.claude-haiku-4-5-20251001-v1:0',
  sonnet: 'anthropic.claude-sonnet-4-6-20250514-v1:0',
  opus: 'anthropic.claude-opus-4-6-20250501-v1:0',
};

export function createAgentNode<T extends z.ZodType>(config: AgentConfig<T>): AgentNodeFn {
  const { modelId, maxTokens, temperature, schema, promptTemplate } = config;

  return async (state: Record<string, unknown>): Promise<Record<string, unknown>> => {
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
    const result = await structured.invoke(prompt);
    return result as Record<string, unknown>;
  };
}
