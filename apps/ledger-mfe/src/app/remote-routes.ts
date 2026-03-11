import { Routes } from '@angular/router';
import { TimeTravelService } from './services/time-travel.service';
import { ComparisonService } from './services/comparison.service';
import { TimeTravelStore } from './stores/time-travel.store';

export const remoteRoutes: Routes = [
  {
    path: '',
    providers: [TimeTravelService, ComparisonService, TimeTravelStore],
    children: [
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
    ],
  },
];
