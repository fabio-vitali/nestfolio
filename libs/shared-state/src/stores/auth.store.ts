import { inject } from '@angular/core';
import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';
import type { AuthStatus, UserProfile } from '../models';
import { LogoutOrchestrator } from '../logout-orchestrator';

interface AuthState {
  user: UserProfile | null;
  status: AuthStatus;
  /** Email stored temporarily during signup-to-confirm flow */
  pendingEmail: string | null;
}

const initialState: AuthState = {
  user: null,
  status: 'unknown',
  pendingEmail: null,
};

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store) => {
    const logoutOrchestrator = inject(LogoutOrchestrator);

    return {
      setAuthenticated(user: UserProfile): void {
        patchState(store, { user, status: 'authenticated' });
      },
      setUnauthenticated(): void {
        patchState(store, { user: null, status: 'unauthenticated' });
      },
      updateUser(updates: Partial<UserProfile>): void {
        const current = store.user();
        if (current) {
          patchState(store, { user: { ...current, ...updates } });
        }
      },
      setPendingEmail(email: string): void {
        patchState(store, { pendingEmail: email });
      },
      clearPendingEmail(): void {
        patchState(store, { pendingEmail: null });
      },
      reset(): void {
        patchState(store, { ...initialState });
      },
      logout(): void {
        patchState(store, { ...initialState, status: 'unauthenticated' });
        logoutOrchestrator.resetAll();
      },
    };
  }),
);
