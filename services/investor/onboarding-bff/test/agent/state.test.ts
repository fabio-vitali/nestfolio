import { OnboardingStateSchema, PHASE_ORDER, phaseIndexOf } from '../../src/agent/state';

describe('OnboardingStateSchema', () => {
  it('accepts valid initial state', () => {
    const result = OnboardingStateSchema.safeParse({
      phase: 'goal',
      phaseIndex: 0,
      totalPhases: 7,
      messages: [],
    });
    expect(result.success).toBe(true);
  });

  it('accepts fully populated state', () => {
    const result = OnboardingStateSchema.safeParse({
      phase: 'mandate',
      phaseIndex: 6,
      totalPhases: 7,
      goal: 'Crescita',
      horizonYears: 10,
      accountMode: 'simulation',
      capitalAmount: 25000,
      riskProfile: { tolerance: 'hold', experienceLevel: 'novice', score: 25, category: 'conservative' },
      operatingMode: 'balanced',
      mandateAccepted: false,
      messages: [],
    });
    expect(result.success).toBe(true);
  });
});

describe('PHASE_ORDER', () => {
  it('has 7 phases', () => {
    expect(PHASE_ORDER).toHaveLength(7);
  });

  it('starts with goal and ends with mandate', () => {
    expect(PHASE_ORDER[0]).toBe('goal');
    expect(PHASE_ORDER[6]).toBe('mandate');
  });
});

describe('phaseIndexOf', () => {
  it('returns correct index for each phase', () => {
    expect(phaseIndexOf('goal')).toBe(0);
    expect(phaseIndexOf('horizon')).toBe(1);
    expect(phaseIndexOf('mandate')).toBe(6);
  });
});
