import { rebalancePlannerConfig } from '../../../services/advisory/portfolio-engine-ctrl/src/agents/rebalance-planner.config';
import { rebalanceValidationRule } from '../../../services/advisory/portfolio-engine-ctrl/src/agents/validation';

export const benchConfig = {
  taskName: 'rebalance-planner' as const,
  service: 'portfolio-engine-ctrl' as const,
  configFilePath: 'services/advisory/portfolio-engine-ctrl/src/agents/rebalance-planner.config.ts',
  fixturePath: 'benchmarks/fixtures/rebalance-planner.input.json',
  productionConfig: rebalancePlannerConfig,
  validationRule: rebalanceValidationRule,
  tier: 'structured-output-frontier' as const,
};
