import { computed } from '@angular/core';
import { signalStoreFeature, withComputed, withState } from '@ngrx/signals';

export type CallState = 'init' | 'loading' | 'loaded' | 'error';

export function withCallState() {
  return signalStoreFeature(
    withState<{ callState: CallState; callError: string | null }>({
      callState: 'init',
      callError: null,
    }),
    withComputed(({ callState, callError }) => ({
      loading: computed(() => callState() === 'loading'),
      loaded: computed(() => callState() === 'loaded'),
      error: computed(() => callError()),
    })),
  );
}

export function setLoading(): { callState: CallState; callError: null } {
  return { callState: 'loading', callError: null };
}

export function setLoaded(): { callState: CallState; callError: null } {
  return { callState: 'loaded', callError: null };
}

export function setError(msg: string): { callState: CallState; callError: string } {
  return { callState: 'error', callError: msg };
}
