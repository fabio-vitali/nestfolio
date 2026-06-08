import { InvestorProfileUpdatedSchema } from '../../../src/domain/contracts';

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

describe('InvestorProfileUpdatedSchema', () => {
  it('parses a representative InvestorProfile subject', () => {
    const result = InvestorProfileUpdatedSchema.safeParse(validSubject);
    expect(result.success).toBe(true);
  });

  it('parses when optional fields are absent', () => {
    const { onboardingCompletedAt: _onboardingCompletedAt, __version, ...minimal } = validSubject;
    const result = InvestorProfileUpdatedSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('throws when goal is absent', () => {
    const { goal: _goal, ...withoutGoal } = validSubject;
    const result = InvestorProfileUpdatedSchema.safeParse(withoutGoal);
    expect(result.success).toBe(false);
  });

  it('throws when riskProfile is absent', () => {
    const { riskProfile: _riskProfile, ...withoutRisk } = validSubject;
    const result = InvestorProfileUpdatedSchema.safeParse(withoutRisk);
    expect(result.success).toBe(false);
  });

  it('throws when goal.objective is absent', () => {
    const { objective: _objective, ...goalWithoutObjective } = validSubject.goal;
    const result = InvestorProfileUpdatedSchema.safeParse({ ...validSubject, goal: goalWithoutObjective });
    expect(result.success).toBe(false);
  });

  it('throws when riskProfile.score is absent', () => {
    const { score: _score, ...riskWithoutScore } = validSubject.riskProfile;
    const result = InvestorProfileUpdatedSchema.safeParse({ ...validSubject, riskProfile: riskWithoutScore });
    expect(result.success).toBe(false);
  });
});
