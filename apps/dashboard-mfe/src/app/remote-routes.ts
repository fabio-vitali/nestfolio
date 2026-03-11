import { Routes } from '@angular/router';

export const remoteRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./dashboard/dashboard-container.component').then(
        (m) => m.DashboardContainerComponent,
      ),
  },
];
