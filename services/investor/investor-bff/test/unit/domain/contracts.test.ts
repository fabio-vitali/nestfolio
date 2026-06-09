import { InvestorProfileUpdatedSchema, NotificationReadSchema } from '../../../src/domain/contracts';
import { MandateSchema, ExecutionModeChangedSchema } from '@nestfolio/investor-adpt/domain';

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

describe('investor-bff NotificationReadSchema', () => {
  const notificationRow = {
    tenantId: 't', userId: 'u',
    notificationId: 'n1', channel: 'push', title: 'Hi', body: 'Body',
    relatedEntityType: 'DECISION', relatedEntityId: 'd1',
    status: 'READ', read: true, readAt: '2026-06-09T00:00:00.000Z',
    createdAt: '2026-06-09T00:00:00.000Z',
  };
  it('parses a real Notification read-model row (dry — identity stripped)', () => {
    const parsed = NotificationReadSchema.parse(notificationRow);
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.notificationId).toBe('n1');
  });
  it('parses the CREATED state (readAt absent, read=false)', () => {
    const { readAt: _r, ...created } = notificationRow;
    expect(NotificationReadSchema.parse({ ...created, status: 'CREATED', read: false }).status).toBe('CREATED');
  });
  it('throws when notificationId is absent', () => {
    const { notificationId: _n, ...without } = notificationRow;
    expect(() => NotificationReadSchema.parse(without)).toThrow();
  });
});

describe('investor-bff Mandate row parses the investor-adpt Mandate contract', () => {
  it('a real Mandate sibling-row shape validates', () => {
    const mandateRow = {
      tenantId: 't', userId: 'u', region: 'us-east-1',
      mandateId: 'm1', level: 'DISCRETIONARY', status: 'ACTIVE',
      operatingMode: 'CONSERVATIVE', effectiveDate: '2026-06-09T00:00:00.000Z',
      revokedAt: null, __version: 1,
    };
    expect(MandateSchema.parse(mandateRow).operatingMode).toBe('CONSERVATIVE');
  });
});

describe('investor-bff ExecutionModeChange row parses the investor-adpt ExecutionModeChanged contract', () => {
  it('a real ExecutionModeChange audit-row shape validates', () => {
    const row = {
      tenantId: 't', userId: 'u', region: 'us-east-1',
      changeId: 't#u#2026', fromMode: 'simulation', toMode: 'live',
      changedAt: '2026-06-09T00:00:00.000Z',
    };
    expect(ExecutionModeChangedSchema.parse(row).toMode).toBe('live');
  });
});
