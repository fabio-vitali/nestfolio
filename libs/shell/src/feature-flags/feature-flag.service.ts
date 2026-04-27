import { Injectable, OnDestroy, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { gql, ApolloClient } from '@apollo/client/core';
import { FeatureFlagsStore, GET_FEATURE_FLAGS, ON_FEATURE_FLAG_UPDATE } from '@nestfolio/ui/feature-flags';
import type { FeatureFlag } from '@nestfolio/ui/feature-flags';
import { FEATURE_FLAG_APOLLO_CLIENT } from './feature-flag-apollo-client';

@Injectable()
export class FeatureFlagService implements OnDestroy {
  private readonly store = inject(FeatureFlagsStore);
  private readonly client = inject<ApolloClient>(FEATURE_FLAG_APOLLO_CLIENT);
  private subscription: Subscription | null = null;

  constructor() {
    this.loadInitialFlags();
    this.subscribeToUpdates();
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

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }
}
