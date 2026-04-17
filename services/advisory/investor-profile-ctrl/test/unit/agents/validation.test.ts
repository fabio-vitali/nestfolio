import { goalsValidationRule, riskValidationRule } from '../../../src/agents/validation';

describe('Goals validation', () => {
  const validOutput = {
    goals: ['retirement'],
    timeHorizon: '10-15 years',
    riskWillingness: 'moderate',
    confidence: 0.85,
  };

  it('passes valid output', () => {
    expect(goalsValidationRule.validate(validOutput).valid).toBe(true);
  });

  it('fails with empty goals', () => {
    const r = goalsValidationRule.validate({ ...validOutput, goals: [] });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('goal');
  });

  it('fails with empty timeHorizon', () => {
    const r = goalsValidationRule.validate({ ...validOutput, timeHorizon: '' });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('timeHorizon');
  });
});

describe('Risk assessment validation', () => {
  const validOutput = {
    riskScore: 45,
    riskCategory: 'MODERATE',
    regulatoryFlags: [],
    suitabilityAssessment: 'Suitable for moderate-risk balanced portfolio allocation',
    confidence: 0.9,
  };

  it('passes valid output', () => {
    expect(riskValidationRule.validate(validOutput).valid).toBe(true);
  });

  it('fails when low score with AGGRESSIVE category', () => {
    const r = riskValidationRule.validate({ ...validOutput, riskScore: 10, riskCategory: 'AGGRESSIVE' });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('inconsistent');
  });

  it('fails when high score with CONSERVATIVE category', () => {
    const r = riskValidationRule.validate({ ...validOutput, riskScore: 90, riskCategory: 'CONSERVATIVE' });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('inconsistent');
  });

  it('fails with short suitabilityAssessment', () => {
    const r = riskValidationRule.validate({ ...validOutput, suitabilityAssessment: 'OK' });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('suitabilityAssessment');
  });
});
