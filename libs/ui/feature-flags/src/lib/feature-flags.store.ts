import { computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import type { FeatureFlag } from './feature-flags.model';

interface FeatureFlagsState {
  flags: Record<string, FeatureFlag>;
}

const initialState: FeatureFlagsState = { flags: {} };

export const FeatureFlagsStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((store) => ({
    disabledFlags: computed(() =>
      Object.values(store.flags()).filter(f => !f.enabled),
    ),
  })),
  withMethods((store) => ({
    setFlags(flags: FeatureFlag[]): void {
      const record = Object.fromEntries(flags.map(f => [f.name, f]));
      patchState(store, { flags: record });
    },
    updateFlag(flag: FeatureFlag): void {
      patchState(store, { flags: { ...store.flags(), [flag.name]: flag } });
    },
    isEnabled(name: string): boolean {
      return store.flags()[name]?.enabled ?? true;
    },
  })),
);
