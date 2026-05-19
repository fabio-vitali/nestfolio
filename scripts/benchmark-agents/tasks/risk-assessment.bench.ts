import { riskAssessmentConfig } from '../../../services/advisory/investor-profile-ctrl/src/agents/risk-assessment.config';

export const benchConfig = {
  taskName: 'risk-assessment' as const,
  service: 'investor-profile-ctrl' as const,
  configFilePath: 'services/advisory/investor-profile-ctrl/src/agents/risk-assessment.config.ts',
  fixturePath: 'benchmarks/fixtures/risk-assessment.input.json',
  productionConfig: riskAssessmentConfig,
  validationRule: null as const,
  models: [
    'us.anthropic.claude-sonnet-4-6',
    'us.anthropic.claude-sonnet-4-7',
    'us.anthropic.claude-opus-4-6-v1',
    'amazon.nova-pro-v1:0',
    'amazon.nova-premier-v1:0',
  ],
};
