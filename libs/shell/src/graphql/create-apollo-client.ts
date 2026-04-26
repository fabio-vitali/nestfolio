import { ApolloClient, InMemoryCache, HttpLink, ApolloLink } from '@apollo/client/core';
import { onError } from '@apollo/client/link/error';
import { CombinedGraphQLErrors, ServerError } from '@apollo/client/errors';
import { createAuthLink, AUTH_TYPE, AuthOptions } from 'aws-appsync-auth-link';
import { createSubscriptionHandshakeLink } from 'aws-appsync-subscription-link';

export interface CreateApolloClientOptions {
  /** BFF domain literal: 'investor' | 'advisory' | 'dashboard' | 'ledger'. */
  domain: string;
  /** AWS region for AppSync auth-link header construction. */
  region: string;
  /** Returns a Cognito ID token for outgoing requests. */
  jwtTokenProvider: () => Promise<string>;
  /** Invoked synchronously by errorLink on 401/403 / UNAUTHORIZED. */
  onAuthFailure: (reason: string) => void;
}

export function createApolloClient(opts: CreateApolloClientOptions): ApolloClient {
  const { domain, region, jwtTokenProvider, onAuthFailure } = opts;

  const httpUri = `/graphql/${domain}`;
  const realtimeUrl = `${window.location.origin}/realtime/${domain}`;

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
    { url: realtimeUrl, region, auth },
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
