import { Route, Routes } from '@angular/router';
import { loadRemoteModule } from '@angular-architects/native-federation';
import { authGuard, onboardingPendingGuard, onboardingCompletedGuard } from '@nestfolio/shell/auth';
import { provideMfeGraphql } from '@nestfolio/shell/graphql';
import { MfeErrorComponent } from './mfe-error.component';

// Native Federation contract: each MFE exposes `export const remoteRoutes: Routes`
// from its `./routes` entry. Angular Router's `loadChildren` accepts a `Routes`
// array (or NgModule shapes) — NOT a `{ remoteRoutes: Routes }` wrapper.
// Returning the wrapper makes Router fall through to the legacy NgModule path
// and crash with `TypeError: Cannot read properties of null (reading 'bootstrap')`.
// See docs/superpowers/specs/2026-04-27-f-loadmfe-routes-shape-design.md.
export function loadMfe(remoteName: string, exposedModule: string) {
  return () =>
    loadRemoteModule(remoteName, exposedModule)
      .then((m) => (m as { remoteRoutes: Routes }).remoteRoutes)
      .catch((): Routes => [{ path: '**', component: MfeErrorComponent }]);
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
    // No provideMfeGraphql — onboarding-bff has no Facade / AppSync API; the
    // onboarding-mfe drives the CopilotKit bridge at /api/copilotkit*.
    // Documented exception per charter A3 + spec §6.7.
    path: 'onboarding',
    canActivate: [authGuard, onboardingPendingGuard],
    loadChildren: loadMfe('onboarding-mfe', './routes'),
  },
  {
    path: 'investor',
    providers: [provideMfeGraphql('investor')],
    canActivate: [authGuard, onboardingCompletedGuard],
    loadChildren: loadMfe('investor-mfe', './routes'),
  },
  {
    path: 'dashboard',
    providers: [provideMfeGraphql('dashboard')],
    canActivate: [authGuard, onboardingCompletedGuard],
    loadChildren: loadMfe('dashboard-mfe', './routes'),
  },
  {
    path: 'advisory',
    providers: [provideMfeGraphql('advisory')],
    canActivate: [authGuard, onboardingCompletedGuard],
    loadChildren: loadMfe('advisory-mfe', './routes'),
  },
  {
    path: 'ledger',
    providers: [provideMfeGraphql('ledger')],
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
