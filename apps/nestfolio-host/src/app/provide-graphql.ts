import { Provider } from '@angular/core';
import { APPSYNC_CONFIG, GraphqlService } from '@nestfolio/shell/graphql';
import { getRuntimeConfig, RuntimeConfig } from './app.config';

export function provideGraphqlFor(bffName: keyof RuntimeConfig['appsync']): Provider[] {
  return [
    { provide: APPSYNC_CONFIG, useFactory: () => getRuntimeConfig().appsync[bffName] },
    { provide: GraphqlService, useClass: GraphqlService },
  ];
}
