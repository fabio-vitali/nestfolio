import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { GraphqlService, CachedQuery } from '@nestfolio/shell/graphql';
import {
  GET_DASHBOARD,
  GET_POSITION_SNAPSHOTS,
  GET_RECENT_ACTIVITY,
  GET_SIMULATION_SUMMARY,
  ON_DASHBOARD_UPDATE,
  ON_ACTIVITY_UPDATE,
  ON_POSITION_UPDATE,
} from '../graphql/dashboard-bff.queries';
import { LogoutOrchestrator } from '@nestfolio/shell';
import type {
  DashboardData,
  AdvisoryStatus,
  PortfolioSummary,
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
   * a DDB-stream-driven Lambda whenever the `AdvisoryStatus` or `PortfolioSummary`
   * row mutates (each broadcast carries only its own surface; the other is null).
   * The subscription's `tenantId` argument matches the mutation's `tenantId`
   * argument, so AppSync only delivers frames for the current tenant.
   */
  subscribeToDashboardUpdates(
    tenantId: string,
  ): Observable<{
    onDashboardUpdate: {
      advisoryStatus: AdvisoryStatus | null;
      portfolioSummary: PortfolioSummary | null;
    } | null;
  }> {
    return this.graphql.subscribe(ON_DASHBOARD_UPDATE, { tenantId });
  }

  /**
   * Live activity feed: dashboard-bff fires `publishActivityUpdate` IAM-signed
   * after each Activity row insert. Frame shape: `{ activity: ActivityEntry }`.
   */
  subscribeToActivityUpdates(
    tenantId: string,
  ): Observable<{ onActivityUpdate: { activity: ActivityEntry } | null }> {
    return this.graphql.subscribe(ON_ACTIVITY_UPDATE, { tenantId });
  }

  /**
   * Live holdings: dashboard-bff fires `publishPositionUpdate` IAM-signed after
   * each PositionSnapshot row mutation (one row per holding; a fully-exited
   * symbol arrives as a quantity:0 frame). Frame shape: `{ position: PositionSnapshot }`.
   */
  subscribeToPositionUpdates(
    tenantId: string,
  ): Observable<{ onPositionUpdate: { position: PositionSnapshot } | null }> {
    return this.graphql.subscribe(ON_POSITION_UPDATE, { tenantId });
  }
}
