import { Routes } from '@angular/router';
import { AdvisoryService } from './services/advisory.service';

export const remoteRoutes: Routes = [
  {
    path: '',
    providers: [AdvisoryService],
    children: [
      {
        path: ':id',
        loadComponent: () =>
          import('./decision/decision-detail.component').then(
            (m) => m.DecisionDetailComponent,
          ),
      },
      {
        path: '',
        loadComponent: () =>
          import('./decision-list/decision-list.component').then(
            (m) => m.DecisionListComponent,
          ),
      },
    ],
  },
];
