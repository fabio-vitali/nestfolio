import { Injectable, OnDestroy, effect, inject, untracked } from '@angular/core';
import { Subscription } from 'rxjs';
import { gql, ApolloClient } from '@apollo/client/core';
import { FeatureFlagsStore, GET_FEATURE_FLAGS, ON_FEATURE_FLAG_UPDATE } from '@nestfolio/ui/feature-flags';
import type { FeatureFlag } from '@nestfolio/ui/feature-flags';
import { AuthStore } from '../stores/auth.store';
import { LogoutOrchestrator } from '../logout-orchestrator';
import { FEATURE_FLAG_APOLLO_CLIENT } from './feature-flag-apollo-client';

/**
 * Shell-root feature-flag lifecycle.
 *
 * The service stays inert until `AuthStore.status` transitions into
 * `'authenticated'`. Anonymous routes (login/signup/confirm) never fire a
 * `getFeatureFlags` query, eliminating the bootstrap 401 against
 * `/graphql/investor`.
 *
 * On logout, `LogoutOrchestrator` invokes the registered reset which tears
 * down the live subscription and clears `FeatureFlagsStore`. A subsequent
 * `'authenticated'` transition reloads cleanly.
 *
 * See docs/superpowers/specs/2026-04-27-g-feature-flags-lazy-after-auth-design.md.
 */
@Injectable()
export class FeatureFlagService implements OnDestroy {
  private readonly store = inject(FeatureFlagsStore);
  private readonly client = inject<ApolloClient>(FEATURE_FLAG_APOLLO_CLIENT);
  private readonly authStore = inject(AuthStore);
  private readonly logoutOrchestrator = inject(LogoutOrchestrator);

  private subscription: Subscription | null = null;
  private loaded = false;
  private readonly resetFn = (): void => this.reset();

  constructor() {
    this.logoutOrchestrator.register(this.resetFn);

    effect(() => {
      const status = this.authStore.status();
      if (status !== 'authenticated' || this.loaded) return;
      this.loaded = true;
      untracked(() => {
        this.loadInitialFlags();
        this.subscribeToUpdates();
      });
    });
  }

  private loadInitialFlags(): void {
    this.client
      .query<{ getFeatureFlags: FeatureFlag[] }>({
        query: gql(GET_FEATURE_FLAGS),
      })
      .then((result) => {
        if (result.data) {
          this.store.setFlags(result.data.getFeatureFlags);
        }
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('FeatureFlagService: failed to load initial flags', err);
      });
  }

  private subscribeToUpdates(): void {
    const obs = this.client.subscribe<{ onFeatureFlagUpdate: FeatureFlag }>({
      query: gql(ON_FEATURE_FLAG_UPDATE),
    });
    this.subscription = obs.subscribe({
      next: ({ data }: { data: { onFeatureFlagUpdate: FeatureFlag } | null | undefined }) => {
        if (data?.onFeatureFlagUpdate) {
          this.store.updateFlag(data.onFeatureFlagUpdate);
        }
      },
      error: (err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('FeatureFlagService: subscription error', err);
      },
    });
  }

  private reset(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.store.setFlags([]);
    this.loaded = false;
  }

  ngOnDestroy(): void {
    this.logoutOrchestrator.unregister(this.resetFn);
    this.subscription?.unsubscribe();
    this.subscription = null;
  }
}
