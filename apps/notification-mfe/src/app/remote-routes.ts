import { Routes } from '@angular/router';

export const remoteRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./notifications/notification-list.component').then(
        (m) => m.NotificationListComponent,
      ),
  },
];
