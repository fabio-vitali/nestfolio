import { userGoalsConfig } from '../../../services/advisory/investor-profile-ctrl/src/agents/user-goals.config';

export const benchConfig = {
  taskName: 'user-goals' as const,
  service: 'investor-profile-ctrl' as const,
  configFilePath: 'services/advisory/investor-profile-ctrl/src/agents/user-goals.config.ts',
  fixturePath: 'benchmarks/fixtures/user-goals.input.json',
  productionConfig: userGoalsConfig,
  validationRule: null as const,
  tier: 'structured-output-light' as const,
};
