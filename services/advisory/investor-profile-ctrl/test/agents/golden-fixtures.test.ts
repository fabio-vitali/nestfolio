import { GoalInterpretationSchema, RiskEvaluationSchema } from '../../src/agents/schemas';
import { goalsValidationRule, riskValidationRule } from '../../src/agents/validation';
import { GOLDEN_GOALS, GOLDEN_RISK } from '../../src/agents/fixtures/golden-outputs';

describe('Golden fixtures: schema compliance', () => {
  it('golden goals passes schema', () => {
    expect(GoalInterpretationSchema.safeParse(GOLDEN_GOALS).success).toBe(true);
  });

  it('golden risk passes schema', () => {
    expect(RiskEvaluationSchema.safeParse(GOLDEN_RISK).success).toBe(true);
  });
});

describe('Golden fixtures: business validation', () => {
  it('golden goals passes validation', () => {
    expect(goalsValidationRule.validate(GOLDEN_GOALS as any).valid).toBe(true);
  });

  it('golden risk passes validation', () => {
    expect(riskValidationRule.validate(GOLDEN_RISK as any).valid).toBe(true);
  });
});
