import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { GraphqlService, CachedQuery } from '@nestfolio/shell/graphql';
import {
  GET_DASHBOARD,
  GET_POSITION_SNAPSHOTS,
  GET_RECENT_ACTIVITY,
  GET_SIMULATION_SUMMARY,
  ON_DASHBOARD_UPDATE,
} from '../graphql/dashboard-bff.queries';
import { LogoutOrchestrator } from '@nestfolio/shell';
import type {
  DashboardData,
  AdvisoryStatus,
  PositionSnapshot,
  ActivityEntry,
  SimulationSummary,
} from '../stores/dashboard.store';

@Injectable()
export class DashboardService {
  private readonly graphql = inject(GraphqlService);

  constructor() {
    inject(LogoutOrchestrator).register(() => this.invalidateCaches());
  }

  private readonly dashboardCache = new CachedQuery(
    () => this.graphql.query<{ getDashboard: DashboardData | null }>(GET_DASHBOARD),
    60_000,
  );

  private readonly positionsCache = new CachedQuery(
    () => this.graphql.query<{ getPositionSnapshots: PositionSnapshot[] | null }>(GET_POSITION_SNAPSHOTS),
    60_000,
  );

  async getDashboard(forceRefresh = false): Promise<DashboardData> {
    const data = await this.dashboardCache.get(forceRefresh);
    if (!data.getDashboard) throw new Error('Dashboard data not found');
    return data.getDashboard;
  }

  async getPositionSnapshots(forceRefresh = false): Promise<PositionSnapshot[]> {
    const data = await this.positionsCache.get(forceRefresh);
    return data.getPositionSnapshots ?? [];
  }

  private readonly simulationSummaryCache = new CachedQuery(
    () => this.graphql.query<{ getSimulationSummary: SimulationSummary | null }>(GET_SIMULATION_SUMMARY),
    60_000,
  );

  async getSimulationSummary(forceRefresh = false): Promise<SimulationSummary | null> {
    const data = await this.simulationSummaryCache.get(forceRefresh);
    return data.getSimulationSummary ?? null;
  }

  async getRecentActivity(limit?: number): Promise<ActivityEntry[]> {
    const data = await this.graphql.query<{ getRecentActivity: ActivityEntry[] | null }>(
      GET_RECENT_ACTIVITY,
      limit !== undefined ? { limit } : undefined,
    );
    return data.getRecentActivity ?? [];
  }

  invalidateCaches(): void {
    this.dashboardCache.invalidate();
    this.positionsCache.invalidate();
    this.simulationSummaryCache.invalidate();
  }

  /**
   * Live updates: dashboard-bff fires `publishDashboardUpdate` IAM-signed from
   * a DDB-stream-driven Lambda whenever `AdvisoryStatus` mutates. The
   * subscription's `tenantId` argument matches the mutation's `tenantId`
   * argument, so AppSync only delivers frames for the current tenant.
   */
  subscribeToDashboardUpdates(
    tenantId: string,
  ): Observable<{ onDashboardUpdate: { advisoryStatus: AdvisoryStatus | null } | null }> {
    return this.graphql.subscribe(ON_DASHBOARD_UPDATE, { tenantId });
  }
}
