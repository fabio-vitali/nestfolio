import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthStore } from '../stores/auth.store';

/** Allows access only if the user has NOT completed onboarding. */
export const onboardingPendingGuard: CanActivateFn = () => {
  const router = inject(Router);
  const authStore = inject(AuthStore);
  const user = authStore.user();

  if (!user) return router.createUrlTree(['/login']);
  if (user.onboardingCompletedAt) return router.createUrlTree(['/dashboard']);
  return true;
};

/** Allows access only if the user HAS completed onboarding. */
export const onboardingCompletedGuard: CanActivateFn = () => {
  const router = inject(Router);
  const authStore = inject(AuthStore);
  const user = authStore.user();

  if (!user) return router.createUrlTree(['/login']);
  if (!user.onboardingCompletedAt) return router.createUrlTree(['/onboarding']);
  return true;
};
