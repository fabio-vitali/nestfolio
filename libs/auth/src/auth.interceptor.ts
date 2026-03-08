import { inject } from '@angular/core';
import { type HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, EMPTY, from, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { type AuthTokens, getAuthSession, forceRefreshSession } from './auth.service';

let inflightSession: Promise<AuthTokens | null> | null = null;

function getSharedSession(): Promise<AuthTokens | null> {
  if (!inflightSession) {
    inflightSession = getAuthSession().finally(() => {
      inflightSession = null;
    });
  }
  return inflightSession;
}

/** Tracks whether a 401 retry is already in progress to prevent infinite refresh loops. */
let isRetrying = false;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.includes('/assets/') || !req.url.includes('appsync')) {
    return next(req);
  }

  const router = inject(Router);

  return new Observable<import('@angular/common/http').HttpEvent<unknown>>(subscriber => {
    getSharedSession().then(tokens => {
      if (tokens) {
        const authReq = req.clone({
          setHeaders: { Authorization: tokens.idToken },
        });
        next(authReq).pipe(
          catchError((error: HttpErrorResponse) => {
            if (error.status === 401 && !isRetrying) {
              isRetrying = true;
              return from(forceRefreshSession()).pipe(
                switchMap((newTokens) => {
                  isRetrying = false;
                  if (!newTokens) {
                    router.navigate(['/login']);
                    return EMPTY;
                  }
                  const retryReq = req.clone({
                    setHeaders: { Authorization: newTokens.idToken },
                  });
                  return next(retryReq);
                }),
                catchError(() => {
                  isRetrying = false;
                  router.navigate(['/login']);
                  return EMPTY;
                }),
              );
            }
            if (error.status === 401 && isRetrying) {
              isRetrying = false;
              router.navigate(['/login']);
              return EMPTY;
            }
            return throwError(() => error);
          }),
        ).subscribe(subscriber);
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

/** @internal — exposed for testing only */
export function _resetRetryFlag(): void {
  isRetrying = false;
}
