import { OnboardingSessionSchema, OnboardingCompletedRecordSchema, PhasesSchema } from '../../src/domain/schemas';

describe('OnboardingSessionSchema', () => {
  it('validates a valid in-progress session', () => {
    const session = {
      sessionId: 'sess-1',
      status: 'in_progress',
      currentPhase: 'capital',
      phaseIndex: 3,
      phases: {
        goal: { objective: 'Capital growth' },
        horizon: { years: 5 },
        mode: { accountMode: 'simulation' },
      },
      agentMemorySessionId: 'mem-1',
      startedAt: '2026-03-24T00:00:00Z',
      ttl: 1711324800,
    };
    expect(OnboardingSessionSchema.parse(session)).toBeDefined();
  });

  it('rejects invalid phase', () => {
    expect(() =>
      OnboardingSessionSchema.parse({
        sessionId: 'x', status: 'in_progress', currentPhase: 'invalid',
        phaseIndex: 0, phases: {}, agentMemorySessionId: 'y',
        startedAt: '2026-01-01T00:00:00Z', ttl: 0,
      }),
    ).toThrow();
  });
});

describe('OnboardingCompletedRecordSchema', () => {
  it('validates a completed record with raw onboarding data', () => {
    const record = {
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
      userId: 'user-1',
      goal: { objective: 'Retirement savings' },
      horizonYears: 10,
      accountMode: 'simulation',
      capitalAmount: 25000,
      currency: 'EUR',
      riskTolerance: 2,
      riskExperience: 1,
      operatingMode: 'BALANCED',
      mandateAccepted: true,
    };
    expect(OnboardingCompletedRecordSchema.parse(record)).toBeDefined();
  });
});
