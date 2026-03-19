import {
  AccountModeSchema,
  OnboardingSessionSchema,
  OnboardingPhaseSchema,
  RiskProfileDataSchema,
} from '../../src/service-domain/schemas';

describe('AccountModeSchema', () => {
  it('accepts valid simulation mode', () => {
    const result = AccountModeSchema.safeParse({
      mode: 'simulation',
      capitalAmount: 10000,
      currency: 'EUR',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid live mode', () => {
    const result = AccountModeSchema.safeParse({
      mode: 'live',
      capitalAmount: 50000,
      currency: 'EUR',
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative capitalAmount', () => {
    const result = AccountModeSchema.safeParse({
      mode: 'simulation',
      capitalAmount: -100,
      currency: 'EUR',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown mode', () => {
    const result = AccountModeSchema.safeParse({
      mode: 'demo',
      capitalAmount: 10000,
      currency: 'EUR',
    });
    expect(result.success).toBe(false);
  });
});

describe('OnboardingSessionSchema', () => {
  it('accepts valid session', () => {
    const result = OnboardingSessionSchema.safeParse({
      sessionId: 'sess-123',
      currentPhase: 'goal',
      phaseIndex: 0,
      startedAt: '2026-03-19T10:00:00Z',
      agentMemorySessionId: 'mem-456',
    });
    expect(result.success).toBe(true);
  });

  it('accepts completed session', () => {
    const result = OnboardingSessionSchema.safeParse({
      sessionId: 'sess-123',
      currentPhase: 'completed',
      phaseIndex: 7,
      startedAt: '2026-03-19T10:00:00Z',
      completedAt: '2026-03-19T10:30:00Z',
      agentMemorySessionId: 'mem-456',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid phase', () => {
    const result = OnboardingSessionSchema.safeParse({
      sessionId: 'sess-123',
      currentPhase: 'invalid',
      phaseIndex: 0,
      startedAt: '2026-03-19T10:00:00Z',
      agentMemorySessionId: 'mem-456',
    });
    expect(result.success).toBe(false);
  });
});

describe('OnboardingPhaseSchema', () => {
  it('validates all 7 phases', () => {
    const phases = ['goal', 'horizon', 'mode', 'capital', 'risk', 'operating_mode', 'mandate'];
    for (const phase of phases) {
      expect(OnboardingPhaseSchema.safeParse(phase).success).toBe(true);
    }
  });

  it('validates completed as valid value', () => {
    expect(OnboardingPhaseSchema.safeParse('completed').success).toBe(true);
  });
});

describe('RiskProfileDataSchema', () => {
  it('accepts valid risk profile', () => {
    const result = RiskProfileDataSchema.safeParse({
      tolerance: 'hold',
      experienceLevel: 'novice',
      score: 25,
      category: 'conservative',
    });
    expect(result.success).toBe(true);
  });

  it('rejects score out of range', () => {
    const result = RiskProfileDataSchema.safeParse({
      tolerance: 'hold',
      experienceLevel: 'novice',
      score: 150,
      category: 'conservative',
    });
    expect(result.success).toBe(false);
  });
});
