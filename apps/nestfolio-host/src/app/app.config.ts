import { ApplicationConfig, provideZonelessChangeDetection, APP_INITIALIZER, ErrorHandler, isDevMode, inject } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideAuth, authInterceptor, getAuthUser } from '@nestfolio/auth';
import { provideI18n } from '@nestfolio/i18n';
import { provideNestfolioTheme } from '@nestfolio/ui-components';
import { provideAppSync } from '@nestfolio/appsync-client';
import { AuthStore, GlobalErrorHandler } from '@nestfolio/shared-state';
import { appRoutes } from './app.routes';
import { environment } from '../environments/environment';

export interface RuntimeConfig {
  auth: { userPoolId: string; clientId: string; region: string };
  appsync: {
    investorBff: { endpoint: string; region: string };
    portfolioBff: { endpoint: string; region: string };
    advisoryBff: { endpoint: string; region: string };
    dashboardBff: { endpoint: string; region: string };
    orderLedger: { endpoint: string; region: string };
  };
}

let runtimeConfig: RuntimeConfig | null = null;

export function getRuntimeConfig(): RuntimeConfig {
  return runtimeConfig ?? environment;
}

export function validateEndpoints(config: RuntimeConfig): void {
  const endpoints = [
    config.appsync.investorBff.endpoint,
    config.appsync.portfolioBff.endpoint,
    config.appsync.advisoryBff.endpoint,
    config.appsync.dashboardBff.endpoint,
    config.appsync.orderLedger.endpoint,
  ];

  for (const url of endpoints) {
    if (!url) continue;
    if (url.startsWith('https://')) continue;
    if (isDevMode() && url.startsWith('http://localhost')) continue;
    throw new Error(`Invalid endpoint URL: "${url}". All endpoints must use HTTPS.`);
  }
}

function loadRuntimeConfig(): () => Promise<void> {
  return async () => {
    if (!environment.production) {
      runtimeConfig = environment;
      return;
    }
    try {
      const response = await fetch('/assets/config.json');
      const config: RuntimeConfig = await response.json();
      validateEndpoints(config);
      runtimeConfig = config;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Invalid endpoint URL')) {
        throw error;
      }
      runtimeConfig = environment;
    }
  };
}

function initializeAuth(): () => Promise<void> {
  const authStore = inject(AuthStore);
  return async () => {
    const user = await getAuthUser();
    if (user) {
      authStore.setAuthenticated({
        userId: user.userId,
        username: user.username,
        email: user.email ?? '',
        tenantId: user.tenantId ?? '',
      });
    } else {
      authStore.setUnauthenticated();
    }
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideZonelessChangeDetection(),
    provideRouter(appRoutes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAnimationsAsync(),
    provideAuth(environment.auth),
    provideI18n('it-IT'),
    provideNestfolioTheme('light'),
    provideAppSync(environment.appsync.investorBff),
    {
      provide: APP_INITIALIZER,
      useFactory: loadRuntimeConfig,
      multi: true,
    },
    {
      provide: APP_INITIALIZER,
      useFactory: initializeAuth,
      multi: true,
    },
  ],
};
