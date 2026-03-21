import { Route } from '@angular/router';
import { loadRemoteModule } from '@angular-architects/native-federation';
import { authGuard } from '@nestfolio/shell/auth';
import { MfeErrorComponent } from './mfe-error.component';
import { provideGraphqlFor } from './provide-graphql';

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
    path: 'investor',
    providers: [provideGraphqlFor('investorBff')],
    canActivate: [authGuard],
    loadChildren: loadMfe('investor-mfe', './routes'),
  },
  {
    path: 'dashboard',
    providers: [provideGraphqlFor('dashboardBff')],
    canActivate: [authGuard],
    loadChildren: loadMfe('dashboard-mfe', './routes'),
  },
  {
    path: 'advisory',
    providers: [provideGraphqlFor('advisoryBff')],
    canActivate: [authGuard],
    loadChildren: loadMfe('advisory-mfe', './routes'),
  },
  {
    path: 'ledger',
    providers: [provideGraphqlFor('ledgerBff')],
    canActivate: [authGuard],
    loadChildren: loadMfe('ledger-mfe', './routes'),
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
