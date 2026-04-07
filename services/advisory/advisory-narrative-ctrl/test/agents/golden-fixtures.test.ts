import { ExplainabilitySchema } from '../../src/agents/schemas';
import { narrativeValidationRule } from '../../src/agents/validation';
import { GOLDEN_NARRATIVE } from '../../src/agents/fixtures/golden-outputs';

describe('Golden fixtures: schema compliance', () => {
  it('golden narrative passes Zod schema', () => {
    expect(ExplainabilitySchema.safeParse(GOLDEN_NARRATIVE).success).toBe(true);
  });
});

describe('Golden fixtures: business validation', () => {
  it('golden narrative passes validation', () => {
    expect(narrativeValidationRule.validate(GOLDEN_NARRATIVE as Parameters<typeof narrativeValidationRule.validate>[0]).valid).toBe(true);
  });
});
