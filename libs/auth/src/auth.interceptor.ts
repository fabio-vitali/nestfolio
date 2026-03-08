import { inject } from '@angular/core';
import { type HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { type AuthTokens, getAuthSession } from './auth.service';

let inflightSession: Promise<AuthTokens | null> | null = null;

function getSharedSession(): Promise<AuthTokens | null> {
  if (!inflightSession) {
    inflightSession = getAuthSession().finally(() => {
      inflightSession = null;
    });
  }
  return inflightSession;
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.includes('/assets/') || !req.url.includes('appsync')) {
    return next(req);
  }

  const router = inject(Router);

  return new Observable(subscriber => {
    getSharedSession().then(tokens => {
      if (tokens) {
        const authReq = req.clone({
          setHeaders: { Authorization: tokens.idToken },
        });
        next(authReq).subscribe(subscriber);
      } else {
        router.navigate(['/login']);
        subscriber.error(new Error('Session expired'));
      }
    }).catch(() => {
      router.navigate(['/login']);
      subscriber.error(new Error('Session expired'));
    });
  });
};

/** @internal — exposed for testing only */
export function _resetInflightSession(): void {
  inflightSession = null;
}
