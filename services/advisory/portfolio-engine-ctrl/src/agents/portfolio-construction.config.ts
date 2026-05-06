import type { AgentConfig } from '@nestfolio/agent-orchestrator';
import { PortfolioConstructionSchema } from './schemas';
import { buildPortfolioConstructionPrompt, type OperatingMode } from './prompts';

export function buildPortfolioConstructionConfig(
  mode: OperatingMode,
): AgentConfig<typeof PortfolioConstructionSchema> {
  return {
    modelId: 'us.anthropic.claude-opus-4-6-v1',
    maxTokens: 4096,
    temperature: 0.1,
    schema: PortfolioConstructionSchema,
    promptTemplate: buildPortfolioConstructionPrompt(mode),
  };
}
