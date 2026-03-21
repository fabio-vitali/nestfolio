import { inject } from '@angular/core';
import { type HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, EMPTY, from, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { forceRefreshSession } from './auth.service';
import { AuthInterceptorState } from './auth-interceptor-state.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.includes('/assets/') || !req.url.includes('appsync')) {
    return next(req);
  }

  const router = inject(Router);
  const state = inject(AuthInterceptorState);

  return new Observable<import('@angular/common/http').HttpEvent<unknown>>(subscriber => {
    state.getSharedSession().then(tokens => {
      if (tokens) {
        const authReq = req.clone({
          setHeaders: { Authorization: tokens.idToken },
        });
        next(authReq).pipe(
          catchError((error: HttpErrorResponse) => {
            if (error.status === 401 && state.startRetry()) {
              return from(forceRefreshSession()).pipe(
                switchMap((newTokens) => {
                  state.endRetry();
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
                  state.endRetry();
                  router.navigate(['/login']);
                  return EMPTY;
                }),
              );
            }
            if (error.status === 401) {
              state.endRetry();
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
