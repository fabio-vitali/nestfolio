import { Routes } from '@angular/router';
import { OnboardingStore } from './stores/onboarding.store';
import { NotificationService } from './services/notification.service';
import { NotificationStore } from './stores/notification.store';

export const remoteRoutes: Routes = [
  {
    path: '',
    providers: [OnboardingStore, NotificationService, NotificationStore],
    children: [
      {
        path: 'onboarding',
        loadComponent: () =>
          import('./onboarding/onboarding-chat.component').then(
            (m) => m.OnboardingChatComponent,
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
