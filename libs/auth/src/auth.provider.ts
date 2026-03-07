import { type EnvironmentProviders, makeEnvironmentProviders, APP_INITIALIZER } from '@angular/core';
import { Amplify } from 'aws-amplify';
import { type AuthConfig } from './auth.config';

export function provideAuth(config: AuthConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: APP_INITIALIZER,
      useFactory: () => () => {
        Amplify.configure({
          Auth: {
            Cognito: {
              userPoolId: config.userPoolId,
              userPoolClientId: config.clientId,
            },
          },
        });
      },
      multi: true,
    },
  ]);
}
