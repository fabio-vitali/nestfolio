import { Routes } from '@angular/router';
import { NotificationService } from './services/notification.service';
import { NotificationStore } from './stores/notification.store';
import { DepositService } from './services/deposit.service';
import { GoLiveService } from './services/go-live.service';

export const remoteRoutes: Routes = [
  {
    path: '',
    providers: [NotificationService, NotificationStore, DepositService, GoLiveService],
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
      {
        path: 'deposit',
        loadComponent: () =>
          import('./deposit/deposit-form.component').then(
            (m) => m.DepositFormComponent,
          ),
      },
      {
        path: 'deposit/:depositId',
        loadComponent: () =>
          import('./deposit/deposit-pending-page.component').then(
            (m) => m.DepositPendingPageComponent,
          ),
      },
      { path: '', redirectTo: 'notifications', pathMatch: 'full' },
    ],
  },
];
