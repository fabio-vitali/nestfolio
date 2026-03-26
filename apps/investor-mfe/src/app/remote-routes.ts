import { Routes } from '@angular/router';
import { NotificationService } from './services/notification.service';
import { NotificationStore } from './stores/notification.store';

export const remoteRoutes: Routes = [
  {
    path: '',
    providers: [NotificationService, NotificationStore],
    children: [
      {
        path: 'notifications',
        loadComponent: () =>
          import('./notifications/notification-list.component').then(
            (m) => m.NotificationListComponent,
          ),
      },
      {
        path: 'settings/go-live',
        loadComponent: () =>
          import('./settings/go-live/go-live-wizard.component').then(
            (m) => m.GoLiveWizardComponent,
          ),
      },
      { path: '', redirectTo: 'notifications', pathMatch: 'full' },
    ],
  },
];
