import { marketResearchConfig } from '../../../services/advisory/market-intelligence-ctrl/src/agents/market-research.config';

export const benchConfig = {
  taskName: 'market-research' as const,
  service: 'market-intelligence-ctrl' as const,
  configFilePath: 'services/advisory/market-intelligence-ctrl/src/agents/market-research.config.ts',
  fixturePath: 'benchmarks/fixtures/market-research.input.json',
  productionConfig: marketResearchConfig,
  validationRule: null as const,
  models: [
    'us.anthropic.claude-sonnet-4-6',
    'us.anthropic.claude-sonnet-4-7',
    'us.anthropic.claude-opus-4-6-v1',
    'amazon.nova-pro-v1:0',
    'amazon.nova-premier-v1:0',
  ],
};
