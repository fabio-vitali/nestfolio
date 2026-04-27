import { ApplicationConfig, provideZonelessChangeDetection, APP_INITIALIZER, ErrorHandler, isDevMode, inject } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideAuth, authInterceptor, getAuthUser, AuthConfig } from '@nestfolio/shell/auth';
import { provideI18n } from '@nestfolio/shell/i18n';
import { provideNestfolioTheme } from '@nestfolio/ui';
import { AuthStore, GlobalErrorHandler, FeatureFlagService, COPILOT_API_URL } from '@nestfolio/shell';
import { appRoutes } from './app.routes';

export interface RuntimeConfig {
  auth: { userPoolId: string; clientId: string; region: string };
  copilotApiUrl: string;
}

let runtimeConfig: RuntimeConfig | null = null;

export function getRuntimeConfig(): RuntimeConfig {
  if (!runtimeConfig) {
    throw new Error(
      'Runtime config not initialised. fetchRuntimeConfig() must run before bootstrapApplication().',
    );
  }
  return runtimeConfig;
}

export function validateEndpoints(config: RuntimeConfig): void {
  const url = config.copilotApiUrl;
  if (!url) return;
  if (url.startsWith('https://')) return;
  if (isDevMode() && url.startsWith('http://localhost')) return;
  throw new Error(`Invalid endpoint URL: "${url}". All endpoints must use HTTPS.`);
}

/**
 * Fetches `/assets/config.json` and populates the module-scoped
 * `runtimeConfig` so any DI factory that calls `getRuntimeConfig()` during
 * Angular bootstrap finds a populated value. Must be awaited BEFORE
 * `bootstrapApplication()` in `bootstrap.ts`.
 *
 * Fail-hard: every failure mode (404, malformed JSON, validation reject,
 * network error) throws with a named-path remediation.
 */
export async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
  const remediation =
    'Run `pnpm nx run nestfolio-host:config --prefix=<prefix>` (e.g. --prefix=dev for local development).';
  let response: Response;
  try {
    response = await fetch('/assets/config.json');
  } catch (error) {
    throw new Error(
      `Runtime config not reachable at /assets/config.json: ${String(error)}. ${remediation}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Runtime config not found at /assets/config.json (HTTP ${response.status}). ${remediation}`,
    );
  }
  let parsed: RuntimeConfig;
  try {
    parsed = (await response.json()) as RuntimeConfig;
  } catch (error) {
    throw new Error(
      `Runtime config malformed at /assets/config.json: ${String(error)}. Re-run \`pnpm nx run nestfolio-host:config --prefix=<prefix>\`.`,
    );
  }
  validateEndpoints(parsed);
  runtimeConfig = parsed;
  return parsed;
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
        onboardingCompletedAt: user.onboardingCompletedAt ?? null,
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
    {
      provide: AuthConfig,
      useFactory: () => getRuntimeConfig().auth,
    },
    {
      provide: COPILOT_API_URL,
      useFactory: () => getRuntimeConfig().copilotApiUrl,
    },
    provideRouter(appRoutes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAnimationsAsync(),
    provideAuth(),
    provideI18n('it-IT'),
    provideNestfolioTheme('light'),
    {
      provide: APP_INITIALIZER,
      useFactory: initializeAuth,
      multi: true,
    },
    {
      provide: APP_INITIALIZER,
      useFactory: () => {
        inject(FeatureFlagService); // triggers constructor → loads flags + subscribes
        return () => Promise.resolve();
      },
      multi: true,
    },
  ],
};
