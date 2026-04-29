import { InjectionToken } from '@angular/core';

/**
 * BFF domain literal for the active route — one of 'investor' | 'advisory' |
 * 'dashboard' | 'ledger'. Wired by provideMfeGraphql(domain) in route providers.
 */
export const MFE_DOMAIN = new InjectionToken<string>('MFE_DOMAIN');

/**
 * Direct AppSync HTTPS GraphQL endpoint URL for the active route, e.g.
 * `https://<api-id>.appsync-api.<region>.amazonaws.com/graphql`. The
 * subscription link uses this URL to derive the WSS realtime endpoint
 * (replacing `appsync-api`→`appsync-realtime-api` and `https://`→`wss://`).
 *
 * Required because aws-appsync-subscription-link includes the URL host in
 * the connection_init auth payload, and AppSync rejects any host that does
 * not map to one of its APIs (a CloudFront proxy host does not). HTTP
 * queries/mutations are unaffected and continue using the relative
 * `/graphql/<domain>` proxy path.
 *
 * Wired by provideMfeGraphql(domain, urlFactory) in route providers.
 */
export const MFE_APPSYNC_GRAPHQL_URL = new InjectionToken<string>('MFE_APPSYNC_GRAPHQL_URL');
