import {
  APP_INITIALIZER,
  EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthConfig, authSignOut } from '../auth';
import { AuthStore } from '../stores/auth.store';
import {
  FEATURE_FLAG_APOLLO_CLIENT,
  createFeatureFlagApolloClient,
} from './feature-flag-apollo-client';
import { FeatureFlagService } from './feature-flag.service';

/**
 * Wires the shell-root feature-flag stack:
 *
 * - `FEATURE_FLAG_APOLLO_CLIENT` — dedicated Apollo client targeting the
 *   investor BFF (where the feature-flag schema lives), built lazily from
 *   `AuthConfig` so it composes with `provideAuth()` and `fetchRuntimeConfig()`
 *   without ordering footguns.
 * - `FeatureFlagService` — root-scoped, injects the client above (NOT the
 *   per-MFE `GraphqlService`).
 * - `APP_INITIALIZER` — instantiates `FeatureFlagService` so its constructor
 *   kicks off `getFeatureFlags` query + subscription warmup.
 * - Auth-failure handling — on 401/403 from Apollo, signs out + clears the
 *   auth store + navigates to `/login`, matching `GraphqlService.handleAuthFailure`.
 *
 * Apply in the host: `app.config.ts` providers array → `provideFeatureFlags()`.
 *
 * Pattern note: this is the standard "shell-root services own their transports"
 * shape. Replicate for any future cross-cutting concern that needs backend
 * access at bootstrap (telemetry, audit, user-context).
 */
/**
 * @param appsyncGraphqlUrlFactory Returns the direct AppSync WSS URL for
 *   investor-bff (where the feature-flag schema lives). The host resolves
 *   this from runtime config — typically `() => getRuntimeConfig().appsyncGraphqlUrls.investor`.
 *   Required because FeatureFlagService opens a `onFeatureFlagUpdate`
 *   subscription, and AppSync rejects the connection_init when the URL
 *   host is a CloudFront proxy.
 */
export function provideFeatureFlags(appsyncGraphqlUrlFactory: () => string): EnvironmentProviders {
  return makeEnvironmentProviders([
    FeatureFlagService,
    {
      provide: FEATURE_FLAG_APOLLO_CLIENT,
      useFactory: () => {
        const authConfig = inject(AuthConfig);
        const authStore = inject(AuthStore);
        const router = inject(Router);
        const onAuthFailure = (): void => {
          void (async () => {
            try {
              await authSignOut();
            } catch {
              // Fail-safe — still clear local state + navigate.
            } finally {
              authStore.logout();
              await router.navigate(['/login']);
            }
          })();
        };
        return createFeatureFlagApolloClient({
          authConfig,
          appsyncGraphqlUrl: appsyncGraphqlUrlFactory(),
          onAuthFailure,
        });
      },
    },
    {
      provide: APP_INITIALIZER,
      useFactory: () => {
        inject(FeatureFlagService); // triggers constructor → loads + subscribes
        return () => Promise.resolve();
      },
      multi: true,
    },
  ]);
}
