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
  activityId: string;
  activityType: string;
  description: string;
  createdAt: string;
  metadata: string | null;
}

export interface AdvisoryStatus {
  pendingDecisionsCount: number;
  generatingCount: number;
  failedCount: number;
  oldestGeneratingAt: string | null;
  updatedAt: string;
}

// Keep in sync with advisory-mfe decision-list.component.ts STALE_CYCLE_MS.
// A GENERATING signal older than this (with no transition) renders as failed —
// covers uncatchable States.Runtime failures that emit no DECISION_CYCLE_FAILED.
// TODO(extract-shared-advisory-cycle-state-helper): fold into @nestfolio/ui.
const STALE_CYCLE_MS = 6 * 60 * 1000;

function generatingFresh(s: AdvisoryStatus | null, now: number): boolean {
  return !!s && s.generatingCount > 0 && !!s.oldestGeneratingAt
    && now - Date.parse(s.oldestGeneratingAt) < STALE_CYCLE_MS;
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
  now: number;
}

const initialState: DashboardState = {
  portfolioSummary: null,
  advisoryStatus: null,
  investorSnapshot: null,
  positions: [],
  activities: [],
  simulationSummary: null,
  now: Date.now(),
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
    advisoryGenerating: computed(() => generatingFresh(store.advisoryStatus(), store.now())),
    advisoryFailed: computed(() => {
      const s = store.advisoryStatus();
      if (!s || (s.pendingDecisionsCount ?? 0) > 0) return false;
      if (generatingFresh(s, store.now())) return false;
      return s.failedCount > 0 || s.generatingCount > 0;
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
    setAdvisoryStatus(advisoryStatus: AdvisoryStatus | null): void {
      patchState(store, { advisoryStatus });
    },
    setNow(now: number): void {
      patchState(store, { now });
    },
    setPositions(positions: PositionSnapshot[]): void {
      patchState(store, { positions });
    },
    mergeActivities(incoming: ActivityEntry[]): void {
      const existing = store.activities();
      const seen = new Set<string>();
      const merged: ActivityEntry[] = [];
      for (const a of [...incoming, ...existing]) {   // incoming-first: live wins
        if (seen.has(a.activityId)) continue;          // dedupe, keep first
        seen.add(a.activityId);
        merged.push(a);
      }
      merged.sort((l, r) => (l.createdAt < r.createdAt ? 1 : l.createdAt > r.createdAt ? -1 : 0)); // stable desc
      patchState(store, { activities: merged.slice(0, 50) });
    },
    // Intentionally MERGES (not replaces) so a query snapshot can't clobber a
    // live row; use reset() for a hard clear (e.g. logout).
    setActivities(activities: ActivityEntry[]): void {
      this.mergeActivities(activities);
    },
    addActivity(entry: ActivityEntry): void {
      this.mergeActivities([entry]);
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
