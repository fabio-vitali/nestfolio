import { GoalInterpretationSchema, RiskEvaluationSchema } from '../../src/agents/schemas';

describe('GoalInterpretationSchema', () => {
  const validData = {
    goals: ['retirement savings', 'wealth preservation'],
    timeHorizon: '10-15 years',
    riskWillingness: 'moderate',
    confidence: 0.85,
  };

  it('accepts valid data', () => {
    expect(GoalInterpretationSchema.safeParse(validData).success).toBe(true);
  });

  it('rejects confidence > 1', () => {
    expect(GoalInterpretationSchema.safeParse({ ...validData, confidence: 1.5 }).success).toBe(false);
  });

  it('rejects confidence < 0', () => {
    expect(GoalInterpretationSchema.safeParse({ ...validData, confidence: -0.1 }).success).toBe(false);
  });
});

describe('RiskEvaluationSchema', () => {
  const validData = {
    riskScore: 45,
    riskCategory: 'MODERATE' as const,
    regulatoryFlags: [],
    suitabilityAssessment: 'Suitable for moderate-risk balanced portfolio',
    confidence: 0.9,
  };

  it('accepts valid data', () => {
    expect(RiskEvaluationSchema.safeParse(validData).success).toBe(true);
  });

  it('rejects riskScore > 100', () => {
    expect(RiskEvaluationSchema.safeParse({ ...validData, riskScore: 150 }).success).toBe(false);
  });

  it('rejects riskScore < 0', () => {
    expect(RiskEvaluationSchema.safeParse({ ...validData, riskScore: -1 }).success).toBe(false);
  });

  it('rejects invalid riskCategory', () => {
    expect(RiskEvaluationSchema.safeParse({ ...validData, riskCategory: 'ULTRA_RISK' }).success).toBe(false);
  });
});
