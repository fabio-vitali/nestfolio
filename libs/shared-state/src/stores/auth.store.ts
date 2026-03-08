import { inject } from '@angular/core';
import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';
import type { AuthStatus, UserProfile } from '../models';
import { LogoutSignal } from '../logout-signal';

interface AuthState {
  user: UserProfile | null;
  status: AuthStatus;
}

const initialState: AuthState = {
  user: null,
  status: 'unknown',
};

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store) => {
    const logoutSignal = inject(LogoutSignal);

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
      reset(): void {
        patchState(store, { ...initialState });
      },
      logout(): void {
        patchState(store, { ...initialState, status: 'unauthenticated' });
        logoutSignal.emit();
      },
    };
  }),
);
