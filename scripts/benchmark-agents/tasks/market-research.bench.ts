import { marketResearchConfig } from '../../../services/advisory/market-intelligence-ctrl/src/agents/market-research.config';

export const benchConfig = {
  taskName: 'market-research' as const,
  service: 'market-intelligence-ctrl' as const,
  configFilePath: 'services/advisory/market-intelligence-ctrl/src/agents/market-research.config.ts',
  fixturePath: 'benchmarks/fixtures/market-research.input.json',
  productionConfig: marketResearchConfig,
  validationRule: null as const,
  tier: 'narrative' as const,
};
