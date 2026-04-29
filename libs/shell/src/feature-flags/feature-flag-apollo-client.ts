import { InjectionToken } from '@angular/core';
import { ApolloClient } from '@apollo/client/core';
import { fetchAuthSession } from 'aws-amplify/auth';
import { AuthConfig } from '../auth';
import { createApolloClient } from '../graphql/create-apollo-client';

/**
 * Shell-root Apollo client dedicated to feature-flag traffic.
 *
 * The shell needs to query feature flags at APP_INITIALIZER time, BEFORE any
 * MFE route activates. Per Angular's hierarchical-injector contract, route-
 * scoped tokens (like `MFE_DOMAIN`) are invisible at the shell root — so this
 * client must be standalone, owned by the shell, and provided at root.
 *
 * Targets `/graphql/investor` because the feature-flag GraphQL schema lives
 * on `investor-bff`. Cache is intentionally isolated from any per-MFE Apollo
 * client (Apollo Client v4's standard MFE idiom: one client per backend, one
 * cache per client).
 *
 * The shell-root client and the per-route `/investor` client are separate
 * instances. They will hold separate caches. That is correct, not a leak.
 */
export const FEATURE_FLAG_APOLLO_CLIENT = new InjectionToken<ApolloClient>(
  'FEATURE_FLAG_APOLLO_CLIENT',
);

export interface CreateFeatureFlagApolloClientOptions {
  authConfig: AuthConfig;
  /**
   * Direct AppSync WSS realtime URL for investor-bff (the BFF that hosts
   * the feature-flag schema). Required because FeatureFlagService opens a
   * subscription on `onFeatureFlagUpdate`, and AppSync rejects the
   * connection_init when the URL host is a CloudFront proxy. Resolved by
   * the host from runtime config and threaded in via provideFeatureFlags.
   */
  appsyncGraphqlUrl: string;
  onAuthFailure: (reason: string) => void;
}

export function createFeatureFlagApolloClient(
  opts: CreateFeatureFlagApolloClientOptions,
): ApolloClient {
  return createApolloClient({
    domain: 'investor',
    appsyncGraphqlUrl: opts.appsyncGraphqlUrl,
    region: opts.authConfig.region,
    jwtTokenProvider: async () =>
      (await fetchAuthSession()).tokens?.idToken?.toString() ?? '',
    onAuthFailure: opts.onAuthFailure,
  });
}
