import { portfolioConstructionFallback, rebalancePlannerFallback } from '../../src/agents/fallbacks';
import { PortfolioConstructionSchema, RebalancePlanSchema } from '../../src/agents/schemas';
import { portfolioValidationRule, rebalanceValidationRule } from '../../src/agents/validation';

describe('Portfolio engine fallbacks', () => {
  it('portfolio-construction fallback passes schema', () => {
    expect(PortfolioConstructionSchema.safeParse(portfolioConstructionFallback({})).success).toBe(true);
  });

  it('portfolio-construction fallback passes validation', () => {
    expect(portfolioValidationRule.validate(portfolioConstructionFallback({}) as Parameters<typeof portfolioValidationRule.validate>[0]).valid).toBe(true);
  });

  it('rebalance-planner fallback passes schema', () => {
    expect(RebalancePlanSchema.safeParse(rebalancePlannerFallback({})).success).toBe(true);
  });

  it('rebalance-planner fallback passes validation', () => {
    expect(rebalanceValidationRule.validate(rebalancePlannerFallback({}) as Parameters<typeof rebalanceValidationRule.validate>[0]).valid).toBe(true);
  });
});
