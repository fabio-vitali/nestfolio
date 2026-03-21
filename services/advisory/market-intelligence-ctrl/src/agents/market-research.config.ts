import type { AgentConfig } from '@nestfolio/agent-orchestrator';
import { MarketAnalysisOutputSchema } from './schemas';
import { marketResearchPrompt } from './prompts';

export const marketResearchConfig: AgentConfig<typeof MarketAnalysisOutputSchema> = {
  modelId: 'anthropic.claude-sonnet-4-6-20250514-v1:0',
  maxTokens: 4096,
  temperature: 0.2,
  schema: MarketAnalysisOutputSchema,
  promptTemplate: marketResearchPrompt,
};
