import { computed, inject, DestroyRef } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, withHooks, patchState } from '@ngrx/signals';
import { LogoutSignal } from '@nestfolio/shared-state';

export interface PortfolioSummary {
  totalValueCents: number;
  cashBalanceCents: number;
  positionCount: number;
  driftPercent: number;
  updatedAt: string;
}

export interface PositionSnapshot {
  symbol: string;
  assetClass: string | null;
  quantity: number;
  avgCostBasisCents: number;
  currentPriceCents: number;
  marketValueCents: number;
  weightPercent: number;
  unrealizedPnlCents: number;
  lastUpdatedAt: string;
}

export interface ActivityEntry {
  activityType: string;
  description: string;
  timestamp: string;
  metadata: string | null;
}

export interface AdvisoryStatus {
  pendingDecisionsCount: number;
  lastRecommendationAt: string | null;
  lastDecisionStatus: string | null;
  updatedAt: string;
}

export interface InvestorSnapshot {
  goalType: string | null;
  riskLevel: string | null;
  operatingMode: string | null;
  mandateLevel: string | null;
  onboardedAt: string | null;
  updatedAt: string;
}

export interface DashboardData {
  portfolioSummary: PortfolioSummary | null;
  advisoryStatus: AdvisoryStatus | null;
  investorSnapshot: InvestorSnapshot | null;
}

interface DashboardState {
  portfolioSummary: PortfolioSummary | null;
  advisoryStatus: AdvisoryStatus | null;
  investorSnapshot: InvestorSnapshot | null;
  positions: PositionSnapshot[];
  activities: ActivityEntry[];
  loading: boolean;
  error: string | null;
}

const initialState: DashboardState = {
  portfolioSummary: null,
  advisoryStatus: null,
  investorSnapshot: null,
  positions: [],
  activities: [],
  loading: false,
  error: null,
};

export const DashboardStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((store) => ({
    totalPnl: computed(() => {
      const positions = store.positions();
      return positions.reduce((sum, p) => sum + p.unrealizedPnlCents, 0);
    }),
    allocationByAssetClass: computed(() => {
      const positions = store.positions();
      const groups: Record<string, number> = {};
      for (const p of positions) {
        const cls = p.assetClass ?? 'OTHER';
        groups[cls] = (groups[cls] ?? 0) + p.weightPercent;
      }
      return groups;
    }),
    hasAdvisoryAlerts: computed(() => {
      const status = store.advisoryStatus();
      return (status?.pendingDecisionsCount ?? 0) > 0;
    }),
    isLoaded: computed(() => store.portfolioSummary() !== null),
  })),
  withMethods((store) => ({
    setDashboard(data: DashboardData): void {
      patchState(store, {
        portfolioSummary: data.portfolioSummary,
        advisoryStatus: data.advisoryStatus,
        investorSnapshot: data.investorSnapshot,
      });
    },
    setPositions(positions: PositionSnapshot[]): void {
      patchState(store, { positions });
    },
    setActivities(activities: ActivityEntry[]): void {
      patchState(store, { activities });
    },
    setLoading(loading: boolean): void {
      patchState(store, { loading });
    },
    setError(error: string | null): void {
      patchState(store, { error });
    },
    reset(): void {
      patchState(store, { ...initialState });
    },
  })),
  withHooks({
    onInit(store) {
      const logoutSignal = inject(LogoutSignal);
      const destroyRef = inject(DestroyRef);
      const sub = logoutSignal.logout$.subscribe(() => store.reset());
      destroyRef.onDestroy(() => sub.unsubscribe());
    },
  }),
);
