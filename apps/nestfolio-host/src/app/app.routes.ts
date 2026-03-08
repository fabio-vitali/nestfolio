import { Route } from '@angular/router';
import { loadRemoteModule } from '@angular-architects/native-federation';
import { authGuard } from '@nestfolio/auth';
import { MfeErrorComponent } from './mfe-error.component';

function loadMfe(remoteName: string, exposedModule: string) {
  return () =>
    loadRemoteModule(remoteName, exposedModule).catch(() => ({
      remoteRoutes: [{ path: '**', component: MfeErrorComponent }],
    }));
}

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
    loadChildren: loadMfe('dashboard-mfe', './routes'),
  },
  {
    path: 'advisory',
    canActivate: [authGuard],
    loadChildren: loadMfe('advisory-mfe', './routes'),
  },
  {
    path: 'notifications',
    canActivate: [authGuard],
    loadChildren: loadMfe('notification-mfe', './routes'),
  },
  {
    path: 'identity',
    canActivate: [authGuard],
    loadChildren: loadMfe('identity-mfe', './routes'),
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
