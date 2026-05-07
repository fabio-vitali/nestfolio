import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: 'deposit',
    loadComponent: () =>
      import('./deposit/deposit-form.component').then((m) => m.DepositFormComponent),
  },
  {
    path: 'deposit/:depositId',
    loadComponent: () =>
      import('./deposit/deposit-pending-page.component').then((m) => m.DepositPendingPageComponent),
  },
];
