import { userGoalsFallback, riskAssessmentFallback } from '../../src/agents/fallbacks';
import { GoalInterpretationSchema, RiskEvaluationSchema } from '../../src/agents/schemas';
import { goalsValidationRule, riskValidationRule } from '../../src/agents/validation';

describe('Investor profile fallbacks', () => {
  it('user-goals fallback passes schema', () => {
    expect(GoalInterpretationSchema.safeParse(userGoalsFallback({})).success).toBe(true);
  });

  it('user-goals fallback passes validation', () => {
    expect(goalsValidationRule.validate(userGoalsFallback({}) as any).valid).toBe(true);
  });

  it('risk-assessment fallback passes schema', () => {
    expect(RiskEvaluationSchema.safeParse(riskAssessmentFallback({})).success).toBe(true);
  });

  it('risk-assessment fallback passes validation', () => {
    expect(riskValidationRule.validate(riskAssessmentFallback({}) as any).valid).toBe(true);
  });
});
