import { ChatBedrockConverse } from '@langchain/aws';
import type { z } from 'zod';
import type { AgentConfig } from './types';
import type { AgentNodeFn } from './with-validation';

const MODEL_ID_MAP: Record<string, string> = {
  haiku: 'anthropic.claude-3-haiku-20240307-v1:0',
  sonnet: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  opus: 'anthropic.claude-3-opus-20240229-v1:0',
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
