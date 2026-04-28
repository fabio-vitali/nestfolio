import { Routes } from '@angular/router';
import { DashboardService } from './services/dashboard.service';

export const remoteRoutes: Routes = [
  {
    path: '',
    providers: [DashboardService],
    loadComponent: () =>
      import('./dashboard/dashboard-container.component').then(
        (m) => m.DashboardContainerComponent,
      ),
  },
];
