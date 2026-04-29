import { OnboardingStateSchema, PHASE_ORDER, phaseIndexOf } from '../../../src/agent/state';

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
      phase: 'mandate_cta',
      phaseIndex: 6,
      totalPhases: 7,
      goal: 'growth',
      operatingMode: 'balanced',
      horizonYears: 10,
      capitalAmount: 50000,
      mandateAccepted: true,
      messages: [],
    });
    expect(result.success).toBe(true);
  });
});

describe('PHASE_ORDER', () => {
  it('has 7 phases', () => {
    expect(PHASE_ORDER).toHaveLength(7);
  });

  it('starts with goal and ends with mandate_cta', () => {
    expect(PHASE_ORDER[0]).toBe('goal');
    expect(PHASE_ORDER[6]).toBe('mandate_cta');
  });

  it('matches the journey-driven order', () => {
    expect(PHASE_ORDER).toEqual([
      'goal',
      'operating_mode',
      'horizon',
      'capital',
      'mandate_summary',
      'mandate_consent',
      'mandate_cta',
    ]);
  });
});

describe('phaseIndexOf', () => {
  it('returns correct index for each phase', () => {
    expect(phaseIndexOf('goal')).toBe(0);
    expect(phaseIndexOf('operating_mode')).toBe(1);
    expect(phaseIndexOf('horizon')).toBe(2);
    expect(phaseIndexOf('capital')).toBe(3);
    expect(phaseIndexOf('mandate_cta')).toBe(6);
  });
});
