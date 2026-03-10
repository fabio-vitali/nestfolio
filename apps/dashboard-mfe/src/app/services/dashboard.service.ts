import { Injectable, inject } from '@angular/core';
import {
  GraphqlService,
  CachedQuery,
  GET_DASHBOARD,
  GET_POSITION_SNAPSHOTS,
  GET_RECENT_ACTIVITY,
} from '@nestfolio/appsync-client';
import { LogoutOrchestrator } from '@nestfolio/shared-state';
import type {
  DashboardData,
  PositionSnapshot,
  ActivityEntry,
} from '../stores/dashboard.store';

@Injectable({ providedIn: 'root' })
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
  }
}
