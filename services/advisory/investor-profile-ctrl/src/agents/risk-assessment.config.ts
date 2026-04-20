import type { AgentConfig } from '@nestfolio/agent-orchestrator';
import { RiskEvaluationSchema } from './schemas';
import { riskAssessmentPrompt } from './prompts';

export const riskAssessmentConfig: AgentConfig<typeof RiskEvaluationSchema> = {
  modelId: 'us.anthropic.claude-opus-4-6-v1',
  maxTokens: 4096,
  temperature: 0.1,
  schema: RiskEvaluationSchema,
  promptTemplate: riskAssessmentPrompt,
};
