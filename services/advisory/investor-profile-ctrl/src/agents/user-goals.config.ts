import type { AgentConfig } from '@nestfolio/agent-orchestrator';
import { GoalInterpretationSchema } from './schemas';
import { userGoalsPrompt } from './prompts';

export const userGoalsConfig: AgentConfig<typeof GoalInterpretationSchema> = {
  modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  maxTokens: 2048,
  temperature: 0.0,
  schema: GoalInterpretationSchema,
  promptTemplate: userGoalsPrompt,
};
