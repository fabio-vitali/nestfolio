import { explainabilityConfig } from '../../../services/advisory/advisory-narrative-ctrl/src/agents/explainability.config';

export const benchConfig = {
  taskName: 'explainability' as const,
  service: 'advisory-narrative-ctrl' as const,
  configFilePath: 'services/advisory/advisory-narrative-ctrl/src/agents/explainability.config.ts',
  fixturePath: 'benchmarks/fixtures/explainability.input.json',
  productionConfig: explainabilityConfig,
  validationRule: null as const,
  tier: 'narrative' as const,
};
