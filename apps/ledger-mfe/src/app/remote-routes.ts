import { Routes } from '@angular/router';

export const remoteRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./time-travel/time-travel-container.component').then(
        (m) => m.TimeTravelContainerComponent,
      ),
  },
  {
    path: 'simulation',
    loadComponent: () =>
      import('./comparison/comparison-container.component').then(
        (m) => m.ComparisonContainerComponent,
      ),
  },
  {
    path: 'orders',
    loadComponent: () =>
      import('./orders/order-history.component').then(
        (m) => m.OrderHistoryComponent,
      ),
  },
];
