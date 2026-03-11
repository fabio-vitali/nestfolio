import { Routes } from '@angular/router';
import { OnboardingService } from './services/onboarding.service';
import { OnboardingStore } from './stores/onboarding.store';
import { NotificationService } from './services/notification.service';
import { NotificationStore } from './stores/notification.store';

export const remoteRoutes: Routes = [
  {
    path: '',
    providers: [OnboardingService, OnboardingStore, NotificationService, NotificationStore],
    children: [
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
    ],
  },
];
