import { Routes } from '@angular/router';

export const remoteRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./onboarding/onboarding-container.component').then(
        (m) => m.OnboardingContainerComponent,
      ),
  },
];
