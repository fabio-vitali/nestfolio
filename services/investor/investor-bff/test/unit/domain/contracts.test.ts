import { InvestorProfileSubjectSchema } from '../../../src/domain/contracts';

const validSubject = {
  tenantId: 'tenant-123',
  userId: 'user-456',
  operatingMode: 'BALANCED' as const,
  goal: {
    objective: 'RETIREMENT',
    timeHorizonMonths: 120,
    targetAmountCents: 500000,
    currency: 'USD',
    targetReturn: 0.07,
  },
  riskProfile: {
    score: 65,
    band: { minEquity: 0.3, maxEquity: 0.6 },
    toleranceResponse: 'selective',
    experienceLevel: 'intermediate',
  },
  onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
  __version: 1,
};

describe('InvestorProfileSubjectSchema', () => {
  it('parses a representative InvestorProfile subject', () => {
    const result = InvestorProfileSubjectSchema.safeParse(validSubject);
    expect(result.success).toBe(true);
  });

  it('parses when optional fields are absent', () => {
    const { onboardingCompletedAt, __version, ...minimal } = validSubject;
    const result = InvestorProfileSubjectSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('throws when goal is absent', () => {
    const { goal, ...withoutGoal } = validSubject;
    const result = InvestorProfileSubjectSchema.safeParse(withoutGoal);
    expect(result.success).toBe(false);
  });

  it('throws when riskProfile is absent', () => {
    const { riskProfile, ...withoutRisk } = validSubject;
    const result = InvestorProfileSubjectSchema.safeParse(withoutRisk);
    expect(result.success).toBe(false);
  });

  it('throws when goal.objective is absent', () => {
    const { objective, ...goalWithoutObjective } = validSubject.goal;
    const result = InvestorProfileSubjectSchema.safeParse({ ...validSubject, goal: goalWithoutObjective });
    expect(result.success).toBe(false);
  });

  it('throws when riskProfile.score is absent', () => {
    const { score, ...riskWithoutScore } = validSubject.riskProfile;
    const result = InvestorProfileSubjectSchema.safeParse({ ...validSubject, riskProfile: riskWithoutScore });
    expect(result.success).toBe(false);
  });
});
