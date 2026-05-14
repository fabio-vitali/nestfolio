import type { AgentConfig } from '@nestfolio/agent-orchestrator';
import { ExplainabilitySchema } from './schemas';
import { explainabilityPrompt } from './prompts';

export const explainabilityConfig: AgentConfig<typeof ExplainabilitySchema> = {
  modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  maxTokens: 8192,
  temperature: 0.3,
  schema: ExplainabilitySchema,
  promptTemplate: explainabilityPrompt,
};
