import type { AgentConfig } from '@nestfolio/agent-orchestrator';
import { PortfolioConstructionSchema } from './schemas';
import { buildPortfolioConstructionPrompt, type OperatingMode } from './prompts';

export const portfolioConstructionConfig: Omit<
  AgentConfig<typeof PortfolioConstructionSchema>,
  'promptTemplate'
> = {
  modelId: 'us.amazon.nova-pro-v1:0',
  maxTokens: 4096,
  temperature: 0.1,
  schema: PortfolioConstructionSchema,
};

export function buildPortfolioConstructionConfig(
  mode: OperatingMode,
): AgentConfig<typeof PortfolioConstructionSchema> {
  return {
    ...portfolioConstructionConfig,
    promptTemplate: buildPortfolioConstructionPrompt(mode),
  };
}
