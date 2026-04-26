import { Provider } from '@angular/core';
import { GraphqlService } from './graphql.service';
import { MFE_DOMAIN } from './mfe-domain.token';

/**
 * Per-route DI providers for an MFE's Apollo client. Pass the BFF domain
 * literal — one of 'investor' | 'advisory' | 'dashboard' | 'ledger'.
 *
 * Use in a route:
 *   { path: 'investor', providers: [provideMfeGraphql('investor')], ... }
 *
 * `useClass: GraphqlService` is intentional: it forces a per-route instance
 * under Angular's hierarchical injector. Otherwise a parent-route singleton
 * would be reused across siblings and MFE_DOMAIN would resolve from the
 * wrong scope.
 */
export function provideMfeGraphql(domain: string): Provider[] {
  return [
    { provide: MFE_DOMAIN, useValue: domain },
    { provide: GraphqlService, useClass: GraphqlService },
  ];
}
