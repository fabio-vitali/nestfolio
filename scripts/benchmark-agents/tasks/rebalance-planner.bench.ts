import { rebalancePlannerConfig } from '../../../services/advisory/portfolio-engine-ctrl/src/agents/rebalance-planner.config';
import { rebalanceValidationRule } from '../../../services/advisory/portfolio-engine-ctrl/src/agents/validation';

export const benchConfig = {
  taskName: 'rebalance-planner' as const,
  service: 'portfolio-engine-ctrl' as const,
  configFilePath: 'services/advisory/portfolio-engine-ctrl/src/agents/rebalance-planner.config.ts',
  fixturePath: 'benchmarks/fixtures/rebalance-planner.input.json',
  productionConfig: rebalancePlannerConfig,
  validationRule: rebalanceValidationRule,
  models: [
    'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    'us.anthropic.claude-sonnet-4-6',
    'amazon.nova-lite-v1:0',
    'amazon.nova-pro-v1:0',
  ],
};
