import { ApolloClient, InMemoryCache, HttpLink, ApolloLink } from '@apollo/client/core';
import { onError } from '@apollo/client/link/error';
import { CombinedGraphQLErrors, ServerError } from '@apollo/client/errors';
import { createAuthLink, AUTH_TYPE, AuthOptions } from 'aws-appsync-auth-link';
import { createSubscriptionHandshakeLink } from 'aws-appsync-subscription-link';
import { installWssDebugProbe } from './wss-debug-probe';

export interface CreateApolloClientOptions {
  /** BFF domain literal: 'investor' | 'advisory' | 'dashboard' | 'ledger'. */
  domain: string;
  /**
   * Direct AppSync WSS realtime endpoint URL, e.g.
   * `wss://<api-id>.appsync-realtime-api.<region>.amazonaws.com/graphql`.
   *
   * Must be the real AppSync host — `aws-appsync-subscription-link` includes
   * the URL host in the connection_init auth payload, and AppSync rejects
   * any host it cannot map to one of its APIs (so a CloudFront proxy host
   * would fail with HttpNotFoundException). HTTP queries/mutations are
   * unaffected: they use the relative `/graphql/<domain>` path which
   * CloudFront proxies via the `realtime-rewrite` CF Function.
   */
  appsyncGraphqlUrl: string;
  /** AWS region for AppSync auth-link header construction. */
  region: string;
  /** Returns a Cognito ID token for outgoing requests. */
  jwtTokenProvider: () => Promise<string>;
  /** Invoked synchronously by errorLink on 401/403 / UNAUTHORIZED. */
  onAuthFailure: (reason: string) => void;
}

export function createApolloClient(opts: CreateApolloClientOptions): ApolloClient {
  const { domain, appsyncGraphqlUrl, region, jwtTokenProvider, onAuthFailure } = opts;

  installWssDebugProbe(domain);

  const httpUri = `/graphql/${domain}`;

  const auth: AuthOptions = {
    type: AUTH_TYPE.AMAZON_COGNITO_USER_POOLS,
    jwtToken: jwtTokenProvider,
  };

  const errorLink = onError(({ error }) => {
    let isAuthFailure = false;
    if (CombinedGraphQLErrors.is(error)) {
      isAuthFailure = error.errors.some((e) => e.extensions?.['code'] === 'UNAUTHORIZED');
    } else if (ServerError.is(error)) {
      isAuthFailure = error.statusCode === 401 || error.statusCode === 403;
    }
    if (isAuthFailure) {
      onAuthFailure('apollo-401');
    }
  });

  const httpLink = new HttpLink({ uri: httpUri });
  const authLink = createAuthLink({ url: httpUri, region, auth });
  const subscriptionLink = createSubscriptionHandshakeLink(
    { url: appsyncGraphqlUrl, region, auth },
    httpLink,
  );

  return new ApolloClient({
    link: ApolloLink.from([errorLink, authLink, subscriptionLink]),
    cache: new InMemoryCache(),
    defaultOptions: {
      query: { fetchPolicy: 'no-cache' },
      mutate: { fetchPolicy: 'no-cache' },
    },
  });
}
