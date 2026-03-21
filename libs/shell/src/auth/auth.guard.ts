import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { getAuthSession, forceRefreshSession } from './auth.service';

export const authGuard: CanActivateFn = async (_route, state) => {
  const router = inject(Router);

  const session = await getAuthSession();
  if (session) return true;

  // Try refresh before giving up
  const refreshed = await forceRefreshSession().catch(() => null);
  if (refreshed) return true;

  return router.createUrlTree(['/login'], {
    queryParams: { returnUrl: state.url },
  });
};
