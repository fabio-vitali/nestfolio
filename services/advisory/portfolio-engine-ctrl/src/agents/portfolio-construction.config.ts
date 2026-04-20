import type { AgentConfig } from '@nestfolio/agent-orchestrator';
import { PortfolioConstructionSchema } from './schemas';
import { portfolioConstructionPrompt } from './prompts';

export const portfolioConstructionConfig: AgentConfig<typeof PortfolioConstructionSchema> = {
  modelId: 'us.anthropic.claude-opus-4-6-v1',
  maxTokens: 4096,
  temperature: 0.1,
  schema: PortfolioConstructionSchema,
  promptTemplate: portfolioConstructionPrompt,
};
