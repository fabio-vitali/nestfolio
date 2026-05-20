import { riskAssessmentConfig } from '../../../services/advisory/investor-profile-ctrl/src/agents/risk-assessment.config';

export const benchConfig = {
  taskName: 'risk-assessment' as const,
  service: 'investor-profile-ctrl' as const,
  configFilePath: 'services/advisory/investor-profile-ctrl/src/agents/risk-assessment.config.ts',
  fixturePath: 'benchmarks/fixtures/risk-assessment.input.json',
  productionConfig: riskAssessmentConfig,
  validationRule: null as const,
  tier: 'structured-output-frontier' as const,
};
