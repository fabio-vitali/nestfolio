import type { AgentConfig } from '@nestfolio/agent-core';
import { ExplainabilitySchema } from './schemas';
import { explainabilityPrompt } from './prompts';

export const explainabilityConfig: AgentConfig<typeof ExplainabilitySchema> = {
  modelId: 'anthropic.claude-sonnet-4-6-20250514-v1:0',
  maxTokens: 8192,
  temperature: 0.3,
  schema: ExplainabilitySchema,
  promptTemplate: explainabilityPrompt,
};
