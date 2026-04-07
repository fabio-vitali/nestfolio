import { narrativeFallback } from '../../src/agents/fallbacks';
import { ExplainabilitySchema } from '../../src/agents/schemas';
import { narrativeValidationRule } from '../../src/agents/validation';

describe('Narrative fallback', () => {
  it('returns schema-valid output', () => {
    const output = narrativeFallback({});
    expect(ExplainabilitySchema.safeParse(output).success).toBe(true);
  });

  it('passes business validation', () => {
    const output = narrativeFallback({});
    expect(narrativeValidationRule.validate(output as Parameters<typeof narrativeValidationRule.validate>[0]).valid).toBe(true);
  });

  it('has low confidence to signal fallback', () => {
    const output = narrativeFallback({});
    expect(output.confidence).toBeLessThanOrEqual(0.3);
  });
});
