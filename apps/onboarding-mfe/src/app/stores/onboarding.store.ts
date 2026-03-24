import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { withCallState, withDevtools, withLogoutReset } from '@nestfolio/shell';

interface OnboardingChatState {
  phaseIndex: number;
  totalPhases: number;
  phase: string;
  isComplete: boolean;
}

const initialState: OnboardingChatState = {
  phaseIndex: 0,
  totalPhases: 7,
  phase: 'goal',
  isComplete: false,
};

export const OnboardingStore = signalStore(
  withState(initialState),
  withCallState(),
  withComputed((store) => ({
    progress: computed(() => ((store.phaseIndex() + 1) / store.totalPhases()) * 100),
  })),
  withMethods((store) => ({
    updateFromAgent(state: { phaseIndex: number; phase: string }): void {
      patchState(store, { phaseIndex: state.phaseIndex, phase: state.phase });
    },
    markComplete(): void {
      patchState(store, { isComplete: true });
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
