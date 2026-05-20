import type { AgentConfig } from '@nestfolio/agent-orchestrator';
import { RebalancePlanSchema } from './schemas';
import { rebalancePlannerPrompt } from './prompts';

export const rebalancePlannerConfig: AgentConfig<typeof RebalancePlanSchema> = {
  modelId: 'us.amazon.nova-pro-v1:0',
  maxTokens: 4096,
  temperature: 0.1,
  schema: RebalancePlanSchema,
  promptTemplate: rebalancePlannerPrompt,
};
