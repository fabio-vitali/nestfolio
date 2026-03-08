import { ApplicationConfig, provideZoneChangeDetection, APP_INITIALIZER, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideAuth, authInterceptor } from '@nestfolio/auth';
import { provideI18n } from '@nestfolio/i18n';
import { provideNestfolioTheme } from '@nestfolio/ui-components';
import { appRoutes } from './app.routes';
import { environment } from '../environments/environment';

export interface RuntimeConfig {
  auth: { userPoolId: string; clientId: string; region: string };
  appsync: {
    investorBff: { endpoint: string; region: string };
    portfolioBff: { endpoint: string; region: string };
    advisoryBff: { endpoint: string; region: string };
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
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Invalid endpoint URL')) {
        throw err;
      }
      runtimeConfig = environment;
    }
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(appRoutes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAnimationsAsync(),
    provideAuth(environment.auth),
    provideI18n('it-IT'),
    provideNestfolioTheme('light'),
    {
      provide: APP_INITIALIZER,
      useFactory: loadRuntimeConfig,
      multi: true,
    },
  ],
};
