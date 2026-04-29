import { Routes } from '@angular/router';
import { AdvisoryPlaceholderComponent } from './advisory-placeholder.component';
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
        component: AdvisoryPlaceholderComponent,
      },
    ],
  },
];
