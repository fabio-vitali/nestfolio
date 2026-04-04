import { marketResearchFallback } from '../../src/agents/fallbacks';
import { MarketAnalysisOutputSchema } from '../../src/agents/schemas';
import { marketResearchValidationRule } from '../../src/agents/validation';

describe('Market research fallback', () => {
  it('returns schema-valid output', () => {
    const output = marketResearchFallback({});
    expect(MarketAnalysisOutputSchema.safeParse(output).success).toBe(true);
  });

  it('passes business validation', () => {
    const output = marketResearchFallback({});
    expect(marketResearchValidationRule.validate(output as any).valid).toBe(true);
  });

  it('has low confidence to signal fallback', () => {
    const output = marketResearchFallback({});
    expect((output as any).confidenceScore).toBeLessThanOrEqual(0.2);
  });
});
