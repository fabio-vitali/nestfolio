import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';
import type { AuthStatus, UserProfile } from '../models';

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
  withMethods((store) => ({
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
  })),
);
