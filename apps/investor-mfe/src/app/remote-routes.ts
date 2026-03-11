import { Routes } from '@angular/router';

export const remoteRoutes: Routes = [
  {
    path: 'onboarding',
    loadComponent: () =>
      import('./onboarding/onboarding-container.component').then(
        (m) => m.OnboardingContainerComponent,
      ),
  },
  {
    path: 'notifications',
    loadComponent: () =>
      import('./notifications/notification-list.component').then(
        (m) => m.NotificationListComponent,
      ),
  },
  { path: '', redirectTo: 'notifications', pathMatch: 'full' },
];
