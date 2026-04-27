import { type EnvironmentProviders, makeEnvironmentProviders, APP_INITIALIZER, inject, Injector } from '@angular/core';
import { Amplify } from 'aws-amplify';
import { AuthConfig } from './auth.config';

/**
 * Registers the Amplify configuration step as an APP_INITIALIZER.
 *
 * `AuthConfig` is read from DI INSIDE the async initializer body (not at
 * factory-resolution time) to avoid racing the consuming app's
 * runtime-config loader. The optional `awaitConfig` callback is awaited
 * BEFORE the AuthConfig lookup; consumers wire it to whatever signals
 * their runtime-config has been populated. Without `awaitConfig`,
 * AuthConfig is resolved as soon as the initializer body runs (caller's
 * responsibility to ensure it's available by then).
 *
 * Why a callback rather than `inject(AuthConfig)` at factory time:
 * Angular calls all APP_INITIALIZER factories during DI hydration, BEFORE
 * any initializer body runs. A synchronous `inject(AuthConfig)` at
 * factory time triggers AuthConfig.useFactory immediately — and if that
 * factory reads a runtime config that's loaded by a sibling
 * APP_INITIALIZER, it throws because that sibling hasn't run yet. The
 * captured Injector + lazy `injector.get(AuthConfig)` inside the awaited
 * async body sidesteps this race.
 */
export function provideAuth(awaitConfig?: () => Promise<unknown>): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: APP_INITIALIZER,
      useFactory: () => {
        const injector = inject(Injector);
        return async () => {
          if (awaitConfig) {
            await awaitConfig();
          }
          const cfg = injector.get(AuthConfig);
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
