import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import {
  setError as callError,
  setLoading as callLoading,
  withCallState,
  withDevtools,
  withLogoutReset,
} from '@nestfolio/shell';
import { deriveAdvisoryCycleState, type AdvisoryCycleStateInput } from '@nestfolio/ui';

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
  updatedAt: string;
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

// Maps the AdvisoryStatus aggregate row onto the shared cycle-state helper input.
// The staleness ceiling now lives once in @nestfolio/ui (deriveAdvisoryCycleState).
function cycleInput(s: AdvisoryStatus | null, now: number): AdvisoryCycleStateInput {
  return {
    generatingCount: s?.generatingCount ?? 0,
    failedCount: s?.failedCount ?? 0,
    oldestGeneratingAt: s?.oldestGeneratingAt ?? null,
    pendingDecisionsCount: s?.pendingDecisionsCount ?? 0,
    now,
  };
}

export interface InvestorSnapshot {
  goalType: string | null;
  riskLevel: string | null;
  operatingMode: string | null;
  executionMode: string | null;
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
  positionRows: PositionSnapshot[];
  activities: ActivityEntry[];
  simulationSummary: SimulationSummary | null;
  now: number;
}

const initialState: DashboardState = {
  portfolioSummary: null,
  advisoryStatus: null,
  investorSnapshot: null,
  positionRows: [],
  activities: [],
  simulationSummary: null,
  now: Date.now(),
};

export const DashboardStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withCallState(),
  withComputed((store) => ({
    // Holdings for display: drop quantity:0 ghost rows (mirrors the
    // get-position-snapshots resolver) and DERIVE weightPercent from
    // marketValueCents so the column + allocation chart stay self-consistent
    // (Σ = 100%) regardless of which per-symbol live frames have arrived.
    positions: computed(() => {
      const held = store.positionRows().filter((p) => p.quantity > 0);
      const total = held.reduce((sum, p) => sum + p.marketValueCents, 0);
      return held.map((p) => ({
        ...p,
        weightPercent: total > 0 ? (p.marketValueCents / total) * 100 : 0,
      }));
    }),
  })),
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
    advisoryGenerating: computed(
      () => deriveAdvisoryCycleState(cycleInput(store.advisoryStatus(), store.now())).generating,
    ),
    advisoryFailed: computed(
      () => deriveAdvisoryCycleState(cycleInput(store.advisoryStatus(), store.now())).failed,
    ),
    isLoaded: computed(() => store.portfolioSummary() !== null),
    hasSimulationData: computed(() => store.simulationSummary() !== null),
    simulationAdvantagePercent: computed(() => store.simulationSummary()?.returnDifferencePercent ?? 0),
  })),
  withMethods((store) => ({
    // Live last-write-wins by `updatedAt`: drop a STRICTLY-older frame, never
    // overwrite a live value with null. Equal timestamps still apply (idempotent
    // last-write-wins, matching the prior unguarded behaviour). Lets the
    // reconnect backfill snapshot coexist with a newer live frame.
    setPortfolioSummary(incoming: PortfolioSummary | null): void {
      if (!incoming) return;
      const current = store.portfolioSummary();
      if (current && incoming.updatedAt < current.updatedAt) return;
      patchState(store, { portfolioSummary: incoming });
    },
    setAdvisoryStatus(incoming: AdvisoryStatus | null): void {
      if (!incoming) {
        patchState(store, { advisoryStatus: null });
        return;
      }
      const current = store.advisoryStatus();
      if (current && incoming.updatedAt < current.updatedAt) return;
      patchState(store, { advisoryStatus: incoming });
    },
    setInvestorSnapshot(incoming: InvestorSnapshot | null): void {
      if (!incoming) return;
      const current = store.investorSnapshot();
      if (current && incoming.updatedAt < current.updatedAt) return;
      patchState(store, { investorSnapshot: incoming });
    },
    setDashboard(data: DashboardData): void {
      // All three surfaces ride the shared Dashboard channel; route each through
      // its guarded LWW setter so a (re-query) snapshot can't clobber a newer live frame.
      this.setInvestorSnapshot(data.investorSnapshot);
      this.setPortfolioSummary(data.portfolioSummary);
      this.setAdvisoryStatus(data.advisoryStatus);
    },
    setNow(now: number): void {
      patchState(store, { now });
    },
    // Keyed-collection live merge: upsert by `symbol`, last-write-wins by
    // `updatedAt` (drop a strictly-older frame; equal timestamps apply,
    // idempotent — matching setPortfolioSummary). Keeps quantity:0 ghost rows so
    // an out-of-order older frame is still ordered correctly; positions() filters
    // them for display. positionRows preserves insertion order (Map semantics).
    mergePositions(incoming: PositionSnapshot[]): void {
      if (incoming.length === 0) return;
      const bySymbol = new Map<string, PositionSnapshot>();
      for (const p of store.positionRows()) bySymbol.set(p.symbol, p);
      let changed = false;
      for (const p of incoming) {
        const current = bySymbol.get(p.symbol);
        if (current && p.updatedAt < current.updatedAt) continue; // drop strictly-older
        bySymbol.set(p.symbol, p);
        changed = true;
      }
      if (changed) patchState(store, { positionRows: [...bySymbol.values()] });
    },
    addPosition(position: PositionSnapshot): void {
      this.mergePositions([position]);
    },
    // Intentionally MERGES (not replaces) so a query/backfill snapshot can't
    // clobber a newer live frame; use reset() for a hard clear (e.g. logout).
    setPositions(positions: PositionSnapshot[]): void {
      this.mergePositions(positions);
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
