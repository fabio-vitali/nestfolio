import { Routes } from '@angular/router';

export const remoteRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./dashboard/dashboard-container.component').then(
        (m) => m.DashboardContainerComponent,
      ),
  },
  {
    path: 'time-travel',
    loadComponent: () =>
      import('./time-travel/time-travel-container.component').then(
        (m) => m.TimeTravelContainerComponent,
      ),
  },
  {
    path: 'comparison',
    loadComponent: () =>
      import('./comparison/comparison-container.component').then(
        (m) => m.ComparisonContainerComponent,
      ),
  },
];
