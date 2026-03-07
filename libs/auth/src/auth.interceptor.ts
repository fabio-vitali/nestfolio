import { type HttpInterceptorFn } from '@angular/common/http';
import { Observable } from 'rxjs';
import { getAuthSession } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.includes('/assets/') || !req.url.includes('appsync')) {
    return next(req);
  }

  return new Observable(subscriber => {
    getAuthSession().then(tokens => {
      if (tokens) {
        const authReq = req.clone({
          setHeaders: { Authorization: tokens.idToken },
        });
        next(authReq).subscribe(subscriber);
      } else {
        next(req).subscribe(subscriber);
      }
    }).catch(() => {
      next(req).subscribe(subscriber);
    });
  });
};
