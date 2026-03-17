import type { AgentConfig } from '@nestfolio/agent-core';
import { RebalancePlanSchema } from './schemas';
import { rebalancePlannerPrompt } from './prompts';

export const rebalancePlannerConfig: AgentConfig<typeof RebalancePlanSchema> = {
  modelId: 'anthropic.claude-sonnet-4-6-20250514-v1:0',
  maxTokens: 4096,
  temperature: 0.1,
  schema: RebalancePlanSchema,
  promptTemplate: rebalancePlannerPrompt,
};
