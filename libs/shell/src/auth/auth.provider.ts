import { type EnvironmentProviders, makeEnvironmentProviders, APP_INITIALIZER, inject } from '@angular/core';
import { Amplify } from 'aws-amplify';
import { AuthConfig } from './auth.config';

/**
 * Registers the Amplify configuration step as an APP_INITIALIZER.
 * Reads `AuthConfig` from DI at injection time — the value must be provided
 * by the consuming app via `{ provide: AuthConfig, useFactory: () => ... }`.
 *
 * Bootstrap ordering: this initializer must run AFTER the runtime-config
 * loader has populated the source the AuthConfig factory reads from.
 * The shell host (`apps/nestfolio-host`) ensures this by awaiting
 * `fetchRuntimeConfig()` BEFORE `bootstrapApplication()` in `bootstrap.ts`.
 */
export function provideAuth(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: APP_INITIALIZER,
      useFactory: () => {
        const cfg = inject(AuthConfig);
        return () => {
          Amplify.configure({
            Auth: {
              Cognito: {
                userPoolId: cfg.userPoolId,
                userPoolClientId: cfg.clientId,
              },
            },
          });
        };
      },
      multi: true,
    },
  ]);
}
