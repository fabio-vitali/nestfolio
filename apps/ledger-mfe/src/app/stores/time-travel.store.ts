import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import {
  setError as callError,
  setLoading as callLoading,
  withCallState,
  withDevtools,
  withLogoutReset,
} from '@nestfolio/shell';

export interface LedgerPosition {
  symbol: string;
  quantity: number;
  averageCostBasis: number;
  totalCostBasis: number;
  lastFillPrice: number;
}

export interface LedgerPortfolio {
  positions: LedgerPosition[];
  cashBalanceCents: number;
  totalValueCents: number;
  positionCount: number;
  snapshotAt: string;
  streamType: string;
}

interface TimeTravelState {
  selectedDate: string | null;
  portfolio: LedgerPortfolio | null;
  oldestDate: string | null;
  latestDate: string | null;
  available: boolean;
}

const initialState: TimeTravelState = {
  selectedDate: null,
  portfolio: null,
  oldestDate: null,
  latestDate: null,
  available: false,
};

export const TimeTravelStore = signalStore(
  withState(initialState),
  withCallState(),
  withComputed((store) => ({
    isTimeTravel: computed(() => store.selectedDate() !== null),
    dateRange: computed(() => {
      const oldest = store.oldestDate();
      const latest = store.latestDate();
      if (!oldest || !latest) return null;
      return { oldest, latest };
    }),
    totalValueCents: computed(() => store.portfolio()?.totalValueCents ?? 0),
    positionCount: computed(() => store.portfolio()?.positionCount ?? 0),
    positions: computed(() => store.portfolio()?.positions ?? []),
  })),
  withMethods((store) => ({
    setAvailability(data: { available: boolean; oldestDate: string | null; latestDate: string | null }): void {
      patchState(store, {
        available: data.available,
        oldestDate: data.oldestDate,
        latestDate: data.latestDate,
      });
    },
    setSelectedDate(date: string | null): void {
      patchState(store, { selectedDate: date });
    },
    setPortfolio(portfolio: LedgerPortfolio | null): void {
      patchState(store, { portfolio });
    },
    setLoading(v: boolean): void {
      if (v) {
        patchState(store, callLoading());
      } else {
        patchState(store, {
          callState: store.callError() ? ('error' as const) : ('loaded' as const),
        });
      }
    },
    setError(error: string | null): void {
      if (error) {
        patchState(store, callError(error));
      } else {
        patchState(store, { callError: null });
      }
    },
    reset(): void {
      patchState(store, { ...initialState, callState: 'init', callError: null });
    },
  })),
  withLogoutReset(() => ({
    ...initialState,
    callState: 'init' as const,
    callError: null,
  })),
  withDevtools('TimeTravelStore'),
);
