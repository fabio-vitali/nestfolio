import { computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import {
  withCallState,
  setLoading as callLoading,
  setLoaded as callLoaded,
  setError as callError,
  withDevtools,
  withLogoutReset,
} from '@nestfolio/shared-state';

export interface RiskAnswer {
  questionId: string;
  answerId: string;
}

export interface GoalInput {
  objective: string;
  targetAmountCents: number;
  currency: string;
  timeHorizonMonths: number;
}

export interface RiskProfileInput {
  score: number;
  band: { minEquity: number; maxEquity: number };
}

export type OperatingMode = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';

export interface MandateInput {
  level: 'ADVISORY' | 'DISCRETIONARY';
  monthlyTurnoverCapPercent: number;
  coolDownDays: number;
  rebalanceCadence: 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL';
}

interface OnboardingState {
  currentStep: number;
  totalSteps: number;
  riskAnswers: RiskAnswer[];
  goal: GoalInput | null;
  riskProfile: RiskProfileInput | null;
  operatingMode: OperatingMode | null;
  mandate: MandateInput | null;
}

const initialState: OnboardingState = {
  currentStep: 0,
  totalSteps: 6,
  riskAnswers: [],
  goal: null,
  riskProfile: null,
  operatingMode: null,
  mandate: null,
};

export const OnboardingStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withCallState(),
  withComputed((store) => ({
    isFirstStep: computed(() => store.currentStep() === 0),
    isLastStep: computed(() => store.currentStep() === store.totalSteps() - 1),
    progress: computed(() => ((store.currentStep() + 1) / store.totalSteps()) * 100),
    canProceed: computed(() => {
      const step = store.currentStep();
      switch (step) {
        case 0:
          return true; // Welcome step — always proceed
        case 1:
          return store.riskAnswers().length > 0;
        case 2:
          return store.goal() !== null;
        case 3:
          return store.riskProfile() !== null;
        case 4:
          return store.operatingMode() !== null;
        case 5:
          return store.mandate() !== null;
        default:
          return false;
      }
    }),
  })),
  withMethods((store) => ({
    nextStep(): void {
      const next = store.currentStep() + 1;
      if (next < store.totalSteps()) {
        patchState(store, { currentStep: next });
      }
    },
    prevStep(): void {
      const prev = store.currentStep() - 1;
      if (prev >= 0) {
        patchState(store, { currentStep: prev });
      }
    },
    goToStep(step: number): void {
      if (step >= 0 && step < store.totalSteps()) {
        patchState(store, { currentStep: step });
      }
    },
    setRiskAnswers(answers: RiskAnswer[]): void {
      patchState(store, { riskAnswers: answers });
    },
    setGoal(goal: GoalInput): void {
      patchState(store, { goal });
    },
    setRiskProfile(profile: RiskProfileInput): void {
      patchState(store, { riskProfile: profile });
    },
    setOperatingMode(mode: OperatingMode): void {
      patchState(store, { operatingMode: mode });
    },
    setMandate(mandate: MandateInput): void {
      patchState(store, { mandate });
    },
    setLoading(v: boolean): void {
      if (v) {
        patchState(store, callLoading());
      } else {
        patchState(store, { callState: store.callError() ? ('error' as const) : ('loaded' as const) });
      }
    },
    setError(error: string | null): void {
      if (error) {
        patchState(store, callError(error));
      } else {
        patchState(store, { callError: null });
      }
    },
    reset(): void {
      patchState(store, { ...initialState, callState: 'init', callError: null });
    },
  })),
  withLogoutReset(() => ({
    ...initialState,
    callState: 'init' as const,
    callError: null,
  })),
  withDevtools('OnboardingStore'),
);
