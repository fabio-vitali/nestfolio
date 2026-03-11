import { TestBed } from '@angular/core/testing';
import { OnboardingStore } from '../../../src/app/stores/onboarding.store';
import type { GoalInput, MandateInput, RiskAnswer, RiskProfileInput } from '../../../src/app/stores/onboarding.store';
import { LogoutOrchestrator } from '@nestfolio/shared-state';

describe('OnboardingStore', () => {
  let store: InstanceType<typeof OnboardingStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [OnboardingStore],
    });
    store = TestBed.inject(OnboardingStore);
  });

  it('should start with initial state', () => {
    expect(store.currentStep()).toBe(0);
    expect(store.totalSteps()).toBe(6);
    expect(store.riskAnswers()).toEqual([]);
    expect(store.goal()).toBeNull();
    expect(store.riskProfile()).toBeNull();
    expect(store.operatingMode()).toBeNull();
    expect(store.mandate()).toBeNull();
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  describe('navigation', () => {
    it('should go to next step', () => {
      store.nextStep();
      expect(store.currentStep()).toBe(1);
    });

    it('should not exceed max step', () => {
      for (let i = 0; i < 10; i++) {
        store.nextStep();
      }
      expect(store.currentStep()).toBe(5);
    });

    it('should go to previous step', () => {
      store.nextStep();
      store.nextStep();
      store.prevStep();
      expect(store.currentStep()).toBe(1);
    });

    it('should not go below step 0', () => {
      store.prevStep();
      expect(store.currentStep()).toBe(0);
    });

    it('should go to specific step', () => {
      store.goToStep(3);
      expect(store.currentStep()).toBe(3);
    });

    it('should ignore invalid step (negative)', () => {
      store.goToStep(-1);
      expect(store.currentStep()).toBe(0);
    });

    it('should ignore invalid step (too high)', () => {
      store.goToStep(6);
      expect(store.currentStep()).toBe(0);
    });
  });

  describe('computed signals', () => {
    it('isFirstStep should be true at step 0', () => {
      expect(store.isFirstStep()).toBe(true);
    });

    it('isFirstStep should be false at step 1', () => {
      store.nextStep();
      expect(store.isFirstStep()).toBe(false);
    });

    it('isLastStep should be true at step 5', () => {
      store.goToStep(5);
      expect(store.isLastStep()).toBe(true);
    });

    it('isLastStep should be false at step 0', () => {
      expect(store.isLastStep()).toBe(false);
    });

    it('progress should be correct at step 0', () => {
      expect(store.progress()).toBeCloseTo(16.67, 1);
    });

    it('progress should be 100 at last step', () => {
      store.goToStep(5);
      expect(store.progress()).toBe(100);
    });

    it('canProceed should be true at step 0 (Welcome)', () => {
      expect(store.canProceed()).toBe(true);
    });

    it('canProceed should be false at step 1 with no risk answers', () => {
      store.goToStep(1);
      expect(store.canProceed()).toBe(false);
    });

    it('canProceed should be true at step 1 with risk answers', () => {
      store.goToStep(1);
      store.setRiskAnswers([{ questionId: 'q1', answerId: 'a1' }]);
      expect(store.canProceed()).toBe(true);
    });

    it('canProceed should be false at step 2 with no goal', () => {
      store.goToStep(2);
      expect(store.canProceed()).toBe(false);
    });

    it('canProceed should be true at step 2 with goal', () => {
      store.goToStep(2);
      store.setGoal({ objective: 'Retirement', targetAmountCents: 100000, currency: 'EUR', timeHorizonMonths: 120 });
      expect(store.canProceed()).toBe(true);
    });

    it('canProceed should be false at step 3 with no risk profile', () => {
      store.goToStep(3);
      expect(store.canProceed()).toBe(false);
    });

    it('canProceed should be true at step 3 with risk profile', () => {
      store.goToStep(3);
      store.setRiskProfile({ score: 7, band: { minEquity: 40, maxEquity: 60 } });
      expect(store.canProceed()).toBe(true);
    });

    it('canProceed should be false at step 4 with no operating mode', () => {
      store.goToStep(4);
      expect(store.canProceed()).toBe(false);
    });

    it('canProceed should be true at step 4 with operating mode', () => {
      store.goToStep(4);
      store.setOperatingMode('BALANCED');
      expect(store.canProceed()).toBe(true);
    });

    it('canProceed should be false at step 5 with no mandate', () => {
      store.goToStep(5);
      expect(store.canProceed()).toBe(false);
    });

    it('canProceed should be true at step 5 with mandate', () => {
      store.goToStep(5);
      store.setMandate({
        level: 'ADVISORY',
        monthlyTurnoverCapPercent: 10,
        coolDownDays: 5,
        rebalanceCadence: 'QUARTERLY',
      });
      expect(store.canProceed()).toBe(true);
    });
  });

  describe('setters', () => {
    it('should set risk answers', () => {
      const answers: RiskAnswer[] = [
        { questionId: 'q1', answerId: 'a1' },
        { questionId: 'q2', answerId: 'a3' },
      ];
      store.setRiskAnswers(answers);
      expect(store.riskAnswers()).toEqual(answers);
    });

    it('should set goal', () => {
      const goal: GoalInput = {
        objective: 'Retirement',
        targetAmountCents: 500000,
        currency: 'EUR',
        timeHorizonMonths: 240,
      };
      store.setGoal(goal);
      expect(store.goal()).toEqual(goal);
    });

    it('should set risk profile', () => {
      const profile: RiskProfileInput = {
        score: 8,
        band: { minEquity: 50, maxEquity: 80 },
      };
      store.setRiskProfile(profile);
      expect(store.riskProfile()).toEqual(profile);
    });

    it('should set operating mode', () => {
      store.setOperatingMode('AGGRESSIVE');
      expect(store.operatingMode()).toBe('AGGRESSIVE');
    });

    it('should set mandate', () => {
      const mandate: MandateInput = {
        level: 'DISCRETIONARY',
        monthlyTurnoverCapPercent: 15,
        coolDownDays: 3,
        rebalanceCadence: 'MONTHLY',
      };
      store.setMandate(mandate);
      expect(store.mandate()).toEqual(mandate);
    });

    it('should set loading', () => {
      store.setLoading(true);
      expect(store.loading()).toBe(true);
      store.setLoading(false);
      expect(store.loading()).toBe(false);
    });

    it('should set error', () => {
      store.setError('Something went wrong');
      expect(store.error()).toBe('Something went wrong');
      store.setError(null);
      expect(store.error()).toBeNull();
    });
  });

  it('should expose callState-based loading/error signals', () => {
    store.setLoading(true);
    expect(store.loading()).toBe(true);

    store.setLoading(false);
    expect(store.loaded()).toBe(true);

    store.setError('fail');
    expect(store.error()).toBe('fail');
  });

  it('should reset on logout via orchestrator', () => {
    const orchestrator = TestBed.inject(LogoutOrchestrator);
    store.nextStep();
    store.setRiskAnswers([{ questionId: 'q1', answerId: 'a1' }]);
    store.setLoading(true);

    orchestrator.resetAll();

    expect(store.currentStep()).toBe(0);
    expect(store.riskAnswers()).toEqual([]);
    expect(store.loading()).toBe(false);
  });

  describe('reset', () => {
    it('should reset to initial state', () => {
      store.nextStep();
      store.nextStep();
      store.setRiskAnswers([{ questionId: 'q1', answerId: 'a1' }]);
      store.setGoal({ objective: 'Test', targetAmountCents: 100, currency: 'EUR', timeHorizonMonths: 12 });
      store.setRiskProfile({ score: 5, band: { minEquity: 20, maxEquity: 40 } });
      store.setOperatingMode('CONSERVATIVE');
      store.setMandate({ level: 'ADVISORY', monthlyTurnoverCapPercent: 5, coolDownDays: 7, rebalanceCadence: 'QUARTERLY' });
      store.setLoading(true);
      store.setError('error');

      store.reset();

      expect(store.currentStep()).toBe(0);
      expect(store.riskAnswers()).toEqual([]);
      expect(store.goal()).toBeNull();
      expect(store.riskProfile()).toBeNull();
      expect(store.operatingMode()).toBeNull();
      expect(store.mandate()).toBeNull();
      expect(store.loading()).toBe(false);
      expect(store.error()).toBeNull();
    });
  });
});
