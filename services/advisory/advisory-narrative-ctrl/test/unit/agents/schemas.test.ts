import { ExplainabilitySchema } from '../../../src/agents/schemas';

describe('ExplainabilitySchema', () => {
  const validData = {
    summary: 'Your portfolio was rebalanced to maintain your target allocation.',
    rationale: 'Market movements caused your equity allocation to drift above target.',
    keyFactors: ['equity drift', 'risk rebalancing', 'cost efficiency'],
    tone: 'educational',
    wordCount: 250,
    confidence: 0.85,
  };

  it('accepts valid data', () => {
    expect(ExplainabilitySchema.safeParse(validData).success).toBe(true);
  });

  it('rejects missing summary', () => {
    const { summary: _, ...invalid } = validData;
    expect(ExplainabilitySchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects confidence > 1', () => {
    expect(ExplainabilitySchema.safeParse({ ...validData, confidence: 1.5 }).success).toBe(false);
  });

  it('rejects confidence < 0', () => {
    expect(ExplainabilitySchema.safeParse({ ...validData, confidence: -0.1 }).success).toBe(false);
  });

  it('accepts boundary confidence = 0', () => {
    expect(ExplainabilitySchema.safeParse({ ...validData, confidence: 0 }).success).toBe(true);
  });

  it('accepts boundary confidence = 1', () => {
    expect(ExplainabilitySchema.safeParse({ ...validData, confidence: 1 }).success).toBe(true);
  });
});
