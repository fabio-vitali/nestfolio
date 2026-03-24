import { Route } from '@angular/router';
import { loadRemoteModule } from '@angular-architects/native-federation';
import { authGuard, onboardingPendingGuard, onboardingCompletedGuard } from '@nestfolio/shell/auth';
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
    path: 'onboarding',
    canActivate: [authGuard, onboardingPendingGuard],
    loadChildren: loadMfe('onboarding-mfe', './routes'),
  },
  {
    path: 'investor',
    providers: [provideGraphqlFor('investorBff')],
    canActivate: [authGuard, onboardingCompletedGuard],
    loadChildren: loadMfe('investor-mfe', './routes'),
  },
  {
    path: 'dashboard',
    providers: [provideGraphqlFor('dashboardBff')],
    canActivate: [authGuard, onboardingCompletedGuard],
    loadChildren: loadMfe('dashboard-mfe', './routes'),
  },
  {
    path: 'advisory',
    providers: [provideGraphqlFor('advisoryBff')],
    canActivate: [authGuard, onboardingCompletedGuard],
    loadChildren: loadMfe('advisory-mfe', './routes'),
  },
  {
    path: 'ledger',
    providers: [provideGraphqlFor('ledgerBff')],
    canActivate: [authGuard, onboardingCompletedGuard],
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
