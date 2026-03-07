import { type EnvironmentProviders, makeEnvironmentProviders, APP_INITIALIZER } from '@angular/core';
import { Amplify } from 'aws-amplify';
import { type AppSyncConfig } from './appsync.config';

export function provideAppSync(config: AppSyncConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: APP_INITIALIZER,
      useFactory: () => () => {
        const existing = Amplify.getConfig();
        Amplify.configure({
          ...existing,
          API: {
            GraphQL: {
              endpoint: config.endpoint,
              region: config.region,
              defaultAuthMode: 'userPool',
            },
          },
        });
      },
      multi: true,
    },
  ]);
}
