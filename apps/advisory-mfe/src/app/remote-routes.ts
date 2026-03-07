import { Routes } from '@angular/router';

export const remoteRoutes: Routes = [
  {
    path: ':id',
    loadComponent: () =>
      import('./decision/decision-detail.component').then(
        (m) => m.DecisionDetailComponent,
      ),
  },
  {
    path: '',
    redirectTo: '/dashboard',
    pathMatch: 'full',
  },
];
