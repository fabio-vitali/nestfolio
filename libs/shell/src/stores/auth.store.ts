import { inject } from '@angular/core';
import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';
import type { AuthStatus, UserProfile } from '../models';
import { LogoutOrchestrator } from '../logout-orchestrator';
import { withDevtools } from '../features/with-devtools';

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

/**
 * localStorage key mirroring `user.onboardingCompletedAt`. The architectural
 * intent is to read this value from the Cognito `custom:onboarding_completed_at`
 * JWT claim, but no backend handler currently writes that attribute (only
 * `tenant_id` is set, by the PostConfirmation trigger). Until the missing CDC
 * chain is wired, we mirror the value here so an in-memory patch made by
 * `OnboardingChatComponent.onCtaClick` survives a page reload — otherwise the
 * `onboardingCompletedGuard` bounces back to /onboarding on every refresh.
 */
export const ONBOARDING_COMPLETED_KEY = 'nestfolio.onboardingCompletedAt';

function persistOnboardingCompletedAt(value: string | null | undefined): void {
  if (value) {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, value);
  } else {
    localStorage.removeItem(ONBOARDING_COMPLETED_KEY);
  }
}

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store) => {
    const logoutOrchestrator = inject(LogoutOrchestrator);

    return {
      setAuthenticated(user: UserProfile): void {
        patchState(store, { user, status: 'authenticated' });
        persistOnboardingCompletedAt(user.onboardingCompletedAt);
      },
      setUnauthenticated(): void {
        patchState(store, { user: null, status: 'unauthenticated' });
        persistOnboardingCompletedAt(null);
      },
      updateUser(updates: Partial<UserProfile>): void {
        const current = store.user();
        if (current) {
          patchState(store, { user: { ...current, ...updates } });
          if ('onboardingCompletedAt' in updates) {
            persistOnboardingCompletedAt(updates.onboardingCompletedAt);
          }
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
        persistOnboardingCompletedAt(null);
        logoutOrchestrator.resetAll();
      },
    };
  }),
  withDevtools('AuthStore'),
);
