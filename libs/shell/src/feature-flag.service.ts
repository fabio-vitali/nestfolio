import { Injectable, OnDestroy, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { GraphqlService } from './graphql/graphql.service';
import { FeatureFlagsStore, GET_FEATURE_FLAGS, ON_FEATURE_FLAG_UPDATE } from '@nestfolio/ui/feature-flags';
import type { FeatureFlag } from '@nestfolio/ui/feature-flags';

@Injectable()
export class FeatureFlagService implements OnDestroy {
  private readonly store = inject(FeatureFlagsStore);
  private readonly graphql = inject(GraphqlService);
  private subscription: Subscription | null = null;

  constructor() {
    this.loadInitialFlags();
    this.subscribeToUpdates();
  }

  private loadInitialFlags(): void {
    this.graphql
      .query<{ getFeatureFlags: FeatureFlag[] }>(GET_FEATURE_FLAGS)
      .then((data) => this.store.setFlags(data.getFeatureFlags))
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('FeatureFlagService: failed to load initial flags', err);
      });
  }

  private subscribeToUpdates(): void {
    const obs = this.graphql.subscribe<{ onFeatureFlagUpdate: FeatureFlag }>(ON_FEATURE_FLAG_UPDATE);
    this.subscription = obs.subscribe({
      next: (data) => {
        if (data.onFeatureFlagUpdate) {
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
