import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import {
  setError as callError,
  setLoading as callLoading,
  withCallState,
  withDevtools,
  withLogoutReset,
} from '@nestfolio/shell';

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

export interface SimulationSummary {
  actualTotalValueCents: number;
  simulatedTotalValueCents: number;
  actualReturnPercent: number;
  simulatedReturnPercent: number;
  returnDifferencePercent: number;
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
  simulationSummary: SimulationSummary | null;
}

const initialState: DashboardState = {
  portfolioSummary: null,
  advisoryStatus: null,
  investorSnapshot: null,
  positions: [],
  activities: [],
  simulationSummary: null,
};

export const DashboardStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withCallState(),
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
    hasSimulationData: computed(() => store.simulationSummary() !== null),
    simulationAdvantagePercent: computed(() => store.simulationSummary()?.returnDifferencePercent ?? 0),
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
    setSimulationSummary(simulationSummary: SimulationSummary | null): void {
      patchState(store, { simulationSummary });
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
  withDevtools('DashboardStore'),
);
