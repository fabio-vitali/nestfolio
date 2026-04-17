import { PortfolioConstructionSchema, RebalancePlanSchema } from '../../../src/agents/schemas';
import { portfolioValidationRule, rebalanceValidationRule } from '../../../src/agents/validation';
import { GOLDEN_PORTFOLIO, GOLDEN_REBALANCE } from '../../../src/agents/fixtures/golden-outputs';

describe('Golden fixtures: schema compliance', () => {
  it('golden portfolio passes schema', () => {
    expect(PortfolioConstructionSchema.safeParse(GOLDEN_PORTFOLIO).success).toBe(true);
  });

  it('golden rebalance passes schema', () => {
    expect(RebalancePlanSchema.safeParse(GOLDEN_REBALANCE).success).toBe(true);
  });
});

describe('Golden fixtures: business validation', () => {
  it('golden portfolio passes validation', () => {
    expect(portfolioValidationRule.validate(GOLDEN_PORTFOLIO as Parameters<typeof portfolioValidationRule.validate>[0]).valid).toBe(true);
  });

  it('golden rebalance passes validation', () => {
    expect(rebalanceValidationRule.validate(GOLDEN_REBALANCE as Parameters<typeof rebalanceValidationRule.validate>[0]).valid).toBe(true);
  });
});
