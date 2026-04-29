import { Provider } from '@angular/core';
import { GraphqlService } from './graphql.service';
import { MFE_DOMAIN, MFE_APPSYNC_GRAPHQL_URL } from './mfe-domain.token';

/**
 * Per-route DI providers for an MFE's Apollo client. Pass the BFF domain
 * literal — one of 'investor' | 'advisory' | 'dashboard' | 'ledger' — and
 * a factory returning the direct AppSync WSS realtime endpoint URL for
 * that domain.
 *
 * The realtime URL is provided as a factory (not a literal) because the
 * host resolves it from runtime config which loads asynchronously AFTER
 * the route module is imported. The factory runs inside Angular's DI on
 * route activation, by which point fetchRuntimeConfig() has resolved.
 *
 * Use in a route:
 *   {
 *     path: 'investor',
 *     providers: [
 *       provideMfeGraphql('investor', () => cfg.appsyncGraphqlUrls.investor),
 *     ],
 *     ...
 *   }
 *
 * `useClass: GraphqlService` is intentional: it forces a per-route instance
 * under Angular's hierarchical injector. Otherwise a parent-route singleton
 * would be reused across siblings and MFE_DOMAIN would resolve from the
 * wrong scope.
 */
export function provideMfeGraphql(
  domain: string,
  appsyncGraphqlUrlFactory: () => string,
): Provider[] {
  return [
    { provide: MFE_DOMAIN, useValue: domain },
    { provide: MFE_APPSYNC_GRAPHQL_URL, useFactory: appsyncGraphqlUrlFactory },
    { provide: GraphqlService, useClass: GraphqlService },
  ];
}
