import { MarketAnalysisOutputSchema } from '../../src/agents/schemas';
import { marketResearchValidationRule } from '../../src/agents/validation';
import { GOLDEN_MARKET_ANALYSIS } from '../../src/agents/fixtures/golden-outputs';

describe('Golden fixtures: schema compliance', () => {
  it('golden market analysis passes Zod schema', () => {
    expect(MarketAnalysisOutputSchema.safeParse(GOLDEN_MARKET_ANALYSIS).success).toBe(true);
  });
});

describe('Golden fixtures: business validation', () => {
  it('golden market analysis passes validation', () => {
    expect(marketResearchValidationRule.validate(GOLDEN_MARKET_ANALYSIS as any).valid).toBe(true);
  });
});
