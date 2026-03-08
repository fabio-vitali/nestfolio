import { Routes } from '@angular/router';
import { AdvisoryPlaceholderComponent } from './advisory-placeholder.component';

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
    component: AdvisoryPlaceholderComponent,
  },
];
