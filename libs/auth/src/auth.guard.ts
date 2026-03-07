import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { isAuthenticated } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    return router.createUrlTree(['/login']);
  }
  return true;
};
