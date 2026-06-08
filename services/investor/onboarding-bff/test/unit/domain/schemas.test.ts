import { OnboardingSessionSchema, OnboardingCompletedRecordSchema, GoLiveConfirmedRecordSchema } from '../../../src/domain/schemas';

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

  it('defaults flowType to initial when not provided', () => {
    const session = {
      sessionId: 'sess-1',
      status: 'in_progress',
      currentPhase: 'goal',
      phaseIndex: 0,
      phases: {},
      agentMemorySessionId: 'mem-1',
      startedAt: '2026-03-26T00:00:00Z',
      ttl: 1711324800,
    };
    const result = OnboardingSessionSchema.parse(session);
    expect(result.flowType).toBe('initial');
  });

  it('accepts flowType go-live with go-live phases', () => {
    const session = {
      sessionId: 'sess-2',
      status: 'in_progress',
      flowType: 'go-live',
      currentPhase: 'review_risk',
      phaseIndex: 0,
      phases: {},
      agentMemorySessionId: 'mem-2',
      startedAt: '2026-03-26T00:00:00Z',
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

describe('GoLiveConfirmedRecordSchema', () => {
  it('validates a go-live confirmed record', () => {
    const record = {
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
      userId: 'user-1',
      timestamp: '2026-03-26T10:00:00.000Z',
    };
    expect(GoLiveConfirmedRecordSchema.parse(record)).toBeDefined();
  });
});

describe('OnboardingCompletedRecordSchema', () => {
  it('validates a completed record with raw onboarding data', () => {
    const record = {
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
      userId: 'user-1',
      email: 'investor@example.com',
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

  it('accepts a record without email (optional) and with un-clamped raw risk indices', () => {
    // The real onboarding row may omit email and stores the RAW tolerance/experience
    // indices (the agent's compute-risk only clamps to 0-3 for its own score).
    const record = {
      goal: { objective: 'Retirement savings' },
      horizonYears: 10,
      accountMode: 'simulation',
      capitalAmount: 25000,
      currency: 'EUR',
      riskTolerance: 7,
      riskExperience: 5,
      operatingMode: 'BALANCED',
      mandateAccepted: true,
    };
    expect(OnboardingCompletedRecordSchema.parse(record)).toBeDefined();
  });

  it('rejects a record missing a required domain field (operatingMode)', () => {
    const record = {
      goal: { objective: 'Retirement savings' },
      horizonYears: 10,
      accountMode: 'simulation',
      capitalAmount: 25000,
      currency: 'EUR',
      riskTolerance: 2,
      riskExperience: 1,
      mandateAccepted: true,
    };
    expect(() => OnboardingCompletedRecordSchema.parse(record)).toThrow();
  });
});
