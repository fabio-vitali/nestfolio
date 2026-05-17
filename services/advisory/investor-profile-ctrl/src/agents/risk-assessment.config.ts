import type { AgentConfig } from '@nestfolio/agent-orchestrator';
import { RiskEvaluationSchema } from './schemas';
import { riskAssessmentPrompt } from './prompts';

export const riskAssessmentConfig: AgentConfig<typeof RiskEvaluationSchema> = {
  modelId: 'us.anthropic.claude-sonnet-4-6',
  maxTokens: 4096,
  temperature: 0.1,
  schema: RiskEvaluationSchema,
  promptTemplate: riskAssessmentPrompt,
};
