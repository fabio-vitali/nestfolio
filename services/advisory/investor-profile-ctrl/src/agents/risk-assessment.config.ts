import type { AgentConfig } from '@nestfolio/agent-orchestrator';
import { RiskEvaluationSchema } from './schemas';
import { riskAssessmentPrompt } from './prompts';

export const riskAssessmentConfig: AgentConfig<typeof RiskEvaluationSchema> = {
  modelId: 'anthropic.claude-opus-4-6-20250501-v1:0',
  maxTokens: 4096,
  temperature: 0.1,
  schema: RiskEvaluationSchema,
  promptTemplate: riskAssessmentPrompt,
};
