import { Route } from '@angular/router';
import { loadRemoteModule } from '@angular-architects/native-federation';
import { authGuard } from '@nestfolio/auth';

export const appRoutes: Route[] = [
  {
    path: 'login',
    loadComponent: () => import('./auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'signup',
    loadComponent: () => import('./auth/signup.component').then((m) => m.SignupComponent),
  },
  {
    path: 'confirm',
    loadComponent: () => import('./auth/confirm.component').then((m) => m.ConfirmComponent),
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadChildren: () =>
      loadRemoteModule('dashboard-mfe', './routes').then((m) => m.remoteRoutes),
  },
  {
    path: 'advisory',
    canActivate: [authGuard],
    loadChildren: () =>
      loadRemoteModule('advisory-mfe', './routes').then((m) => m.remoteRoutes),
  },
  {
    path: 'notifications',
    canActivate: [authGuard],
    loadChildren: () =>
      loadRemoteModule('notification-mfe', './routes').then((m) => m.remoteRoutes),
  },
  {
    path: 'identity',
    canActivate: [authGuard],
    loadChildren: () =>
      loadRemoteModule('identity-mfe', './routes').then((m) => m.remoteRoutes),
  },
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
