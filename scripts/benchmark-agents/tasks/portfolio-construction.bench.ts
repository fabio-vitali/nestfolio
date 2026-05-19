import { buildPortfolioConstructionConfig } from '../../../services/advisory/portfolio-engine-ctrl/src/agents/portfolio-construction.config';
import { portfolioValidationRule } from '../../../services/advisory/portfolio-engine-ctrl/src/agents/validation';

export const benchConfig = {
  taskName: 'portfolio-construction' as const,
  service: 'portfolio-engine-ctrl' as const,
  configFilePath: 'services/advisory/portfolio-engine-ctrl/src/agents/portfolio-construction.config.ts',
  operatingMode: 'BALANCED' as const,
  fixturePath: 'benchmarks/fixtures/portfolio-construction.input.json',
  productionConfig: buildPortfolioConstructionConfig('BALANCED'),
  validationRule: portfolioValidationRule,
  models: [
    'us.anthropic.claude-sonnet-4-6',
    'us.anthropic.claude-sonnet-4-7',
    'us.anthropic.claude-opus-4-6-v1',
    'us.anthropic.claude-opus-4-7',
    'amazon.nova-premier-v1:0',
  ],
};
