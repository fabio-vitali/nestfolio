import { narrativeValidationRule } from '../../src/agents/validation';

describe('Narrative validation', () => {
  const validOutput = {
    summary: 'Your portfolio was rebalanced to maintain your target allocation and reduce risk.',
    rationale: 'Market movements caused your equity allocation to drift above target by 5%.',
    keyFactors: ['equity drift', 'risk rebalancing'],
    tone: 'educational',
    wordCount: 250,
    confidence: 0.85,
  };

  it('passes valid narrative output', () => {
    expect(narrativeValidationRule.validate(validOutput).valid).toBe(true);
  });

  it('fails when summary is too short (< 20 chars)', () => {
    const r = narrativeValidationRule.validate({ ...validOutput, summary: 'Too short' });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('summary');
  });

  it('fails when rationale is too short (< 20 chars)', () => {
    const r = narrativeValidationRule.validate({ ...validOutput, rationale: 'Brief' });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('rationale');
  });

  it('fails when keyFactors is empty', () => {
    const r = narrativeValidationRule.validate({ ...validOutput, keyFactors: [] });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('key factor');
  });

  it('fails when wordCount is negative', () => {
    const r = narrativeValidationRule.validate({ ...validOutput, wordCount: -1 });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('wordCount');
  });

  it('fails when wordCount exceeds 2000', () => {
    const r = narrativeValidationRule.validate({ ...validOutput, wordCount: 2500 });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain('wordCount');
  });
});
