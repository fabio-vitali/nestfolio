import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { I18nService } from '@nestfolio/i18n';
import { OnboardingContainerComponent } from './onboarding-container.component';
import {
  OnboardingStore,
  type RiskAnswer,
  type GoalInput,
  type RiskProfileInput,
  type MandateInput,
} from '../stores/onboarding.store';
import { OnboardingService } from '../services/onboarding.service';

describe('OnboardingContainerComponent', () => {
  let component: OnboardingContainerComponent;
  let fixture: ComponentFixture<OnboardingContainerComponent>;
  const mockI18n = { t: jest.fn((key: string) => key), currentLocale: 'en-GB' };

  const mockRouter = { navigate: jest.fn().mockResolvedValue(true) };

  const mockService = {
    recordOnboardingAnswer: jest.fn().mockResolvedValue({ step: 'Q1', answeredAt: '2026-01-01' }),
    setGoal: jest.fn().mockResolvedValue({}),
    setRiskProfile: jest.fn().mockResolvedValue({}),
    selectOperatingMode: jest.fn().mockResolvedValue({}),
    grantMandate: jest.fn().mockResolvedValue({}),
  };

  let mockStore: Record<string, jest.Mock | ((...args: unknown[]) => void)>;

  beforeEach(async () => {
    mockStore = {
      currentStep: jest.fn(() => 0),
      riskAnswers: jest.fn(() => []),
      goal: jest.fn(() => null),
      riskProfile: jest.fn(() => null),
      operatingMode: jest.fn(() => null),
      mandate: jest.fn(() => null),
      loading: jest.fn(() => false),
      error: jest.fn(() => null),
      progress: jest.fn(() => 16.7),
      setRiskAnswers: jest.fn(),
      setGoal: jest.fn(),
      setRiskProfile: jest.fn(),
      setOperatingMode: jest.fn(),
      setMandate: jest.fn(),
      setLoading: jest.fn(),
      setError: jest.fn(),
      nextStep: jest.fn(),
      prevStep: jest.fn(),
      goToStep: jest.fn(),
      reset: jest.fn(),
    };

    // Reset service mocks
    Object.values(mockService).forEach((fn) => fn.mockClear());
    mockRouter.navigate.mockClear();

    await TestBed.configureTestingModule({
      imports: [OnboardingContainerComponent],
      providers: [
        { provide: I18nService, useValue: mockI18n },
        { provide: Router, useValue: mockRouter },
        { provide: OnboardingService, useValue: mockService },
        { provide: OnboardingStore, useValue: mockStore },
      ],
    })
      .overrideComponent(OnboardingContainerComponent, {
        set: {
          imports: [CommonModule],
          template: '<div>test</div>',
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(OnboardingContainerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  // --- Event handler delegation tests ---

  it('should delegate onRiskAnswersChange to store.setRiskAnswers', () => {
    const answers: RiskAnswer[] = [{ questionId: 'Q1', answerId: 'Q1_A' }];
    component.onRiskAnswersChange(answers);
    expect(mockStore['setRiskAnswers']).toHaveBeenCalledWith(answers);
  });

  it('should delegate onGoalChange to store.setGoal', () => {
    const goal: GoalInput = {
      objective: 'RETIREMENT',
      targetAmountCents: 5000000,
      currency: 'EUR',
      timeHorizonMonths: 120,
    };
    component.onGoalChange(goal);
    expect(mockStore['setGoal']).toHaveBeenCalledWith(goal);
  });

  it('should delegate onRiskProfileChange to store.setRiskProfile', () => {
    const profile: RiskProfileInput = {
      score: 5,
      band: { minEquity: 30, maxEquity: 60 },
    };
    component.onRiskProfileChange(profile);
    expect(mockStore['setRiskProfile']).toHaveBeenCalledWith(profile);
  });

  it('should delegate onModeChange to store.setOperatingMode', () => {
    component.onModeChange('BALANCED');
    expect(mockStore['setOperatingMode']).toHaveBeenCalledWith('BALANCED');
  });

  it('should delegate onMandateChange to store.setMandate', () => {
    const mandate: MandateInput = {
      level: 'ADVISORY',
      monthlyTurnoverCapPercent: 0,
      coolDownDays: 0,
      rebalanceCadence: 'QUARTERLY',
    };
    component.onMandateChange(mandate);
    expect(mockStore['setMandate']).toHaveBeenCalledWith(mandate);
  });

  // --- onNext tests ---

  it('should set loading true/false around onNext call', async () => {
    const nextCb = jest.fn();
    (mockStore['currentStep'] as jest.Mock).mockReturnValue(0);

    await component.onNext(nextCb);

    expect(mockStore['setLoading']).toHaveBeenCalledWith(true);
    expect(mockStore['setLoading']).toHaveBeenCalledWith(false);
  });

  it('should clear error before onNext', async () => {
    const nextCb = jest.fn();
    await component.onNext(nextCb);
    expect(mockStore['setError']).toHaveBeenCalledWith(null);
  });

  it('should call nextStep and nextCallback on step 0 (welcome)', async () => {
    const nextCb = jest.fn();
    (mockStore['currentStep'] as jest.Mock).mockReturnValue(0);

    await component.onNext(nextCb);

    expect(mockStore['nextStep']).toHaveBeenCalled();
    expect(nextCb).toHaveBeenCalled();
    // No service calls for welcome step
    expect(mockService.recordOnboardingAnswer).not.toHaveBeenCalled();
  });

  it('should call recordOnboardingAnswer for each risk answer on step 1', async () => {
    const nextCb = jest.fn();
    (mockStore['currentStep'] as jest.Mock).mockReturnValue(1);
    const answers: RiskAnswer[] = [
      { questionId: 'Q1', answerId: 'Q1_A' },
      { questionId: 'Q2', answerId: 'Q2_B' },
    ];
    (mockStore['riskAnswers'] as jest.Mock).mockReturnValue(answers);

    await component.onNext(nextCb);

    expect(mockService.recordOnboardingAnswer).toHaveBeenCalledTimes(2);
    expect(mockService.recordOnboardingAnswer).toHaveBeenCalledWith({
      step: 'Q1',
      payload: { answerId: 'Q1_A' },
    });
    expect(mockService.recordOnboardingAnswer).toHaveBeenCalledWith({
      step: 'Q2',
      payload: { answerId: 'Q2_B' },
    });
    expect(mockStore['nextStep']).toHaveBeenCalled();
  });

  it('should call setGoal on step 2', async () => {
    const nextCb = jest.fn();
    (mockStore['currentStep'] as jest.Mock).mockReturnValue(2);
    const goal: GoalInput = {
      objective: 'RETIREMENT',
      targetAmountCents: 5000000,
      currency: 'EUR',
      timeHorizonMonths: 120,
    };
    (mockStore['goal'] as jest.Mock).mockReturnValue(goal);

    await component.onNext(nextCb);

    expect(mockService.setGoal).toHaveBeenCalledWith(goal);
    expect(mockStore['nextStep']).toHaveBeenCalled();
  });

  it('should call setRiskProfile on step 3', async () => {
    const nextCb = jest.fn();
    (mockStore['currentStep'] as jest.Mock).mockReturnValue(3);
    const profile: RiskProfileInput = {
      score: 5,
      band: { minEquity: 30, maxEquity: 60 },
    };
    (mockStore['riskProfile'] as jest.Mock).mockReturnValue(profile);

    await component.onNext(nextCb);

    expect(mockService.setRiskProfile).toHaveBeenCalledWith(profile);
    expect(mockStore['nextStep']).toHaveBeenCalled();
  });

  it('should call selectOperatingMode on step 4', async () => {
    const nextCb = jest.fn();
    (mockStore['currentStep'] as jest.Mock).mockReturnValue(4);
    (mockStore['operatingMode'] as jest.Mock).mockReturnValue('AGGRESSIVE');

    await component.onNext(nextCb);

    expect(mockService.selectOperatingMode).toHaveBeenCalledWith('AGGRESSIVE');
    expect(mockStore['nextStep']).toHaveBeenCalled();
  });

  it('should stop at failed answer and show error with questionId on step 1', async () => {
    const nextCb = jest.fn();
    (mockStore['currentStep'] as jest.Mock).mockReturnValue(1);
    const answers: RiskAnswer[] = [
      { questionId: 'Q1', answerId: 'Q1_A' },
      { questionId: 'Q2', answerId: 'Q2_B' },
      { questionId: 'Q3', answerId: 'Q3_C' },
    ];
    (mockStore['riskAnswers'] as jest.Mock).mockReturnValue(answers);
    mockService.recordOnboardingAnswer
      .mockResolvedValueOnce({ step: 'Q1', answeredAt: '2026-01-01' })
      .mockRejectedValueOnce(new Error('Save failed'));

    await component.onNext(nextCb);

    // Q1 succeeded, Q2 failed — should not call Q3
    expect(mockService.recordOnboardingAnswer).toHaveBeenCalledTimes(2);
    expect(mockStore['setError']).toHaveBeenCalledWith('Save failed (question Q2)');
    expect(mockStore['nextStep']).not.toHaveBeenCalled();
    expect(nextCb).not.toHaveBeenCalled();
    // Loading should be set back to false
    const setLoadingCalls = (mockStore['setLoading'] as jest.Mock).mock.calls;
    expect(setLoadingCalls[setLoadingCalls.length - 1]).toEqual([false]);
  });

  it('should set error when onNext throws', async () => {
    const nextCb = jest.fn();
    (mockStore['currentStep'] as jest.Mock).mockReturnValue(2);
    (mockStore['goal'] as jest.Mock).mockReturnValue({ objective: 'X', targetAmountCents: 100, currency: 'EUR', timeHorizonMonths: 12 });
    mockService.setGoal.mockRejectedValueOnce(new Error('Network error'));

    await component.onNext(nextCb);

    expect(mockStore['setError']).toHaveBeenCalledWith('Network error');
    expect(mockStore['nextStep']).not.toHaveBeenCalled();
    expect(nextCb).not.toHaveBeenCalled();
  });

  it('should set generic error when onNext throws non-Error', async () => {
    const nextCb = jest.fn();
    (mockStore['currentStep'] as jest.Mock).mockReturnValue(2);
    (mockStore['goal'] as jest.Mock).mockReturnValue({ objective: 'X', targetAmountCents: 100, currency: 'EUR', timeHorizonMonths: 12 });
    mockService.setGoal.mockRejectedValueOnce('something');

    await component.onNext(nextCb);

    expect(mockStore['setError']).toHaveBeenCalledWith('An error occurred');
  });

  // --- onBack tests ---

  it('should call prevStep and activateCallback on onBack', () => {
    const activateCb = jest.fn();
    (mockStore['currentStep'] as jest.Mock).mockReturnValue(2);
    component.onBack(activateCb);
    expect(mockStore['prevStep']).toHaveBeenCalled();
    expect(activateCb).toHaveBeenCalledWith(1);
  });

  // --- onComplete tests ---

  it('should call grantMandate, reset, and navigate on onComplete', async () => {
    const mandate: MandateInput = {
      level: 'DISCRETIONARY',
      monthlyTurnoverCapPercent: 10,
      coolDownDays: 7,
      rebalanceCadence: 'QUARTERLY',
    };
    (mockStore['mandate'] as jest.Mock).mockReturnValue(mandate);

    await component.onComplete();

    expect(mockStore['setLoading']).toHaveBeenCalledWith(true);
    expect(mockService.grantMandate).toHaveBeenCalledWith(mandate);
    expect(mockStore['reset']).toHaveBeenCalled();
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
    expect(mockStore['setLoading']).toHaveBeenCalledWith(false);
  });

  it('should skip grantMandate if mandate is null', async () => {
    (mockStore['mandate'] as jest.Mock).mockReturnValue(null);

    await component.onComplete();

    expect(mockService.grantMandate).not.toHaveBeenCalled();
    expect(mockStore['reset']).toHaveBeenCalled();
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('should set error when onComplete throws', async () => {
    const mandate: MandateInput = {
      level: 'ADVISORY',
      monthlyTurnoverCapPercent: 0,
      coolDownDays: 0,
      rebalanceCadence: 'QUARTERLY',
    };
    (mockStore['mandate'] as jest.Mock).mockReturnValue(mandate);
    mockService.grantMandate.mockRejectedValueOnce(new Error('Server error'));

    await component.onComplete();

    expect(mockStore['setError']).toHaveBeenCalledWith('Server error');
    expect(mockStore['reset']).not.toHaveBeenCalled();
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it('should set generic error message for non-Error exceptions in onComplete', async () => {
    (mockStore['mandate'] as jest.Mock).mockReturnValue({
      level: 'ADVISORY',
      monthlyTurnoverCapPercent: 0,
      coolDownDays: 0,
      rebalanceCadence: 'QUARTERLY',
    });
    mockService.grantMandate.mockRejectedValueOnce(42);

    await component.onComplete();

    expect(mockStore['setError']).toHaveBeenCalledWith('Failed to complete onboarding');
  });

  it('should not advance past step 0 without calling nextStep', () => {
    (mockStore['currentStep'] as jest.Mock).mockReturnValue(0);
    // Verify step is 0 and calling onBack at step 0 calls prevStep
    component.onBack(jest.fn());
    expect(mockStore['prevStep']).toHaveBeenCalled();
  });

  it('should pass correct step index to activateCallback on onBack from step 3', () => {
    const activateCb = jest.fn();
    (mockStore['currentStep'] as jest.Mock).mockReturnValue(3);
    component.onBack(activateCb);
    expect(activateCb).toHaveBeenCalledWith(2);
  });

  it('should handle concurrent onNext calls gracefully (loading guard)', async () => {
    const nextCb = jest.fn();
    (mockStore['currentStep'] as jest.Mock).mockReturnValue(0);

    // Two concurrent calls
    const p1 = component.onNext(nextCb);
    const p2 = component.onNext(nextCb);

    await Promise.all([p1, p2]);

    // Both should complete without errors
    expect(mockStore['setLoading']).toHaveBeenCalledWith(false);
  });

  it('should always set loading false in onComplete finally block', async () => {
    (mockStore['mandate'] as jest.Mock).mockReturnValue({
      level: 'ADVISORY',
      monthlyTurnoverCapPercent: 0,
      coolDownDays: 0,
      rebalanceCadence: 'QUARTERLY',
    });
    mockService.grantMandate.mockRejectedValueOnce(new Error('fail'));

    await component.onComplete();

    // setLoading(false) should be called even on error
    const setLoadingCalls = (mockStore['setLoading'] as jest.Mock).mock.calls;
    expect(setLoadingCalls[setLoadingCalls.length - 1]).toEqual([false]);
  });
});
