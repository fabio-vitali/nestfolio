import { Injectable, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { ApolloClient, gql } from '@apollo/client/core';
import { fetchAuthSession } from 'aws-amplify/auth';
import { AuthConfig, authSignOut } from '../auth';
import { LogoutOrchestrator } from '../logout-orchestrator';
import { AuthStore } from '../stores/auth.store';
import { MFE_DOMAIN, MFE_APPSYNC_GRAPHQL_URL } from './mfe-domain.token';
import { createApolloClient } from './create-apollo-client';

@Injectable()
export class GraphqlService implements OnDestroy {
  private readonly domain = inject(MFE_DOMAIN);
  private readonly appsyncGraphqlUrl = inject(MFE_APPSYNC_GRAPHQL_URL);
  private readonly authConfig = inject(AuthConfig);
  private readonly logoutOrchestrator = inject(LogoutOrchestrator);
  private readonly router = inject(Router);
  private readonly authStore = inject(AuthStore);
  private client: ApolloClient;
  private readonly resetFn = () => this.resetClient();

  constructor() {
    this.client = this.build();
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
    const dom = this.domain;
    // eslint-disable-next-line no-console
    console.log(`[GraphqlService.subscribe] called domain=${dom} variables=`, variables);
    return new Observable<T>((subscriber) => {
      // eslint-disable-next-line no-console
      console.log(`[GraphqlService.subscribe] factory entered domain=${dom} appsyncUrl=${this.appsyncGraphqlUrl}`);
      let apolloSub: ReturnType<typeof this.client.subscribe<T>> | undefined;
      try {
        apolloSub = this.client.subscribe<T>({
          query: gql(statement),
          variables: variables ?? {},
        });
        // eslint-disable-next-line no-console
        console.log(`[GraphqlService.subscribe] client.subscribe returned domain=${dom}`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[GraphqlService.subscribe] client.subscribe THREW domain=${dom}`, err);
        subscriber.error(err);
        return;
      }
      const sub = apolloSub.subscribe({
        next: ({ data }: { data: T | null | undefined }) => {
          // eslint-disable-next-line no-console
          console.log(`[GraphqlService.subscribe] apollo next domain=${dom} hasData=${!!data}`);
          if (data) subscriber.next(data);
        },
        error: (err: unknown) => {
          // eslint-disable-next-line no-console
          console.error(`[GraphqlService.subscribe] apollo error domain=${dom}`, err);
          subscriber.error(err);
        },
        complete: () => {
          // eslint-disable-next-line no-console
          console.log(`[GraphqlService.subscribe] apollo complete domain=${dom}`);
          subscriber.complete();
        },
      });
      // eslint-disable-next-line no-console
      console.log(`[GraphqlService.subscribe] inner subscribe attached domain=${dom}`);
      return () => sub.unsubscribe();
    });
  }

  resetClient(): void {
    this.client.stop();
    this.client = this.build();
  }

  private build(): ApolloClient {
    return createApolloClient({
      domain: this.domain,
      appsyncGraphqlUrl: this.appsyncGraphqlUrl,
      region: this.authConfig.region,
      jwtTokenProvider: async () =>
        (await fetchAuthSession()).tokens?.idToken?.toString() ?? '',
      onAuthFailure: () => { void this.handleAuthFailure(); },
    });
  }

  /**
   * Mirrors LogoutButtonComponent.logout() — see libs/shell/src/components/logout-button.component.ts.
   * Single-flighted in practice because Apollo emits at most one auth-failure
   * error per client and the eventual /login redirect tears down the route
   * tree (and this service).
   */
  private async handleAuthFailure(): Promise<void> {
    try {
      await authSignOut();
    } catch {
      // Fail-safe: still clear local state + navigate even if Amplify rejects.
    } finally {
      this.authStore.logout();
      await this.router.navigate(['/login']);
    }
  }
}
