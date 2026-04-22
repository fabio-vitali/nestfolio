import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: 'deposit',
    loadComponent: () =>
      import('./deposit/deposit-page.component').then((m) => m.DepositPageComponent),
  },
];
