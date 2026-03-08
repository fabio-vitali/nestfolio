import { Injectable } from '@angular/core';
import {
  query,
  GET_DASHBOARD,
  GET_POSITION_SNAPSHOTS,
  GET_RECENT_ACTIVITY,
} from '@nestfolio/appsync-client';
import type {
  DashboardData,
  PositionSnapshot,
  ActivityEntry,
} from '../stores/dashboard.store';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  async getDashboard(): Promise<DashboardData> {
    const data = await query<{ getDashboard: DashboardData | null }>(GET_DASHBOARD);
    if (!data.getDashboard) throw new Error('Dashboard data not found');
    return data.getDashboard;
  }

  async getPositionSnapshots(): Promise<PositionSnapshot[]> {
    const data = await query<{ getPositionSnapshots: PositionSnapshot[] | null }>(GET_POSITION_SNAPSHOTS);
    return data.getPositionSnapshots ?? [];
  }

  async getRecentActivity(limit?: number): Promise<ActivityEntry[]> {
    const data = await query<{ getRecentActivity: ActivityEntry[] | null }>(
      GET_RECENT_ACTIVITY,
      limit !== undefined ? { limit } : undefined,
    );
    return data.getRecentActivity ?? [];
  }
}
