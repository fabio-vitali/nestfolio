import { Injectable, OnDestroy, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApolloClient, InMemoryCache, HttpLink, gql, ApolloLink } from '@apollo/client/core';
import { createAuthLink, AUTH_TYPE, AuthOptions } from 'aws-appsync-auth-link';
import { createSubscriptionHandshakeLink } from 'aws-appsync-subscription-link';
import { fetchAuthSession } from 'aws-amplify/auth';
import { LogoutOrchestrator } from '@nestfolio/shared-state';
import { APPSYNC_CONFIG } from './appsync.config';

@Injectable()
export class GraphqlService implements OnDestroy {
  private readonly config = inject(APPSYNC_CONFIG);
  private readonly logoutOrchestrator = inject(LogoutOrchestrator);
  private client: ApolloClient;
  private readonly resetFn = () => this.resetClient();

  constructor() {
    this.client = this.createApolloClient();
    this.logoutOrchestrator.register(this.resetFn);
  }

  ngOnDestroy(): void {
    this.logoutOrchestrator.unregister(this.resetFn);
    this.client.stop();
  }

  async query<T>(statement: string, variables?: Record<string, unknown>): Promise<T> {
    const result = await this.client.query<T>({
      query: gql(statement),
      variables: variables ?? {},
    });
    return result.data as T;
  }

  async mutate<T>(statement: string, variables?: Record<string, unknown>): Promise<T> {
    const result = await this.client.mutate<T>({
      mutation: gql(statement),
      variables: variables ?? {},
    });
    return result.data as T;
  }

  subscribe<T>(statement: string, variables?: Record<string, unknown>): Observable<T> {
    return new Observable<T>((subscriber) => {
      const sub = this.client
        .subscribe<T>({
          query: gql(statement),
          variables: variables ?? {},
        })
        .subscribe({
          next: ({ data }: { data: T | null | undefined }) => {
            if (data) subscriber.next(data);
          },
          error: (err: unknown) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      return () => sub.unsubscribe();
    });
  }

  resetClient(): void {
    this.client.stop();
    this.client = this.createApolloClient();
  }

  private createApolloClient(): ApolloClient {
    const { endpoint, region } = this.config;

    const auth: AuthOptions = {
      type: AUTH_TYPE.AMAZON_COGNITO_USER_POOLS,
      jwtToken: async () => {
        const session = await fetchAuthSession();
        return session.tokens?.idToken?.toString() ?? '';
      },
    };

    const httpLink = new HttpLink({ uri: endpoint });
    const authLink = createAuthLink({ url: endpoint, region, auth });
    const subscriptionLink = createSubscriptionHandshakeLink(
      { url: endpoint, region, auth },
      httpLink,
    );

    const link = ApolloLink.from([authLink, subscriptionLink]);

    return new ApolloClient({
      link,
      cache: new InMemoryCache(),
      defaultOptions: {
        query: { fetchPolicy: 'no-cache' },
        mutate: { fetchPolicy: 'no-cache' },
      },
    });
  }
}
