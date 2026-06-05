import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { retry, timer, type Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import { MessageModule } from 'primeng/message';
import { I18nService } from '@nestfolio/shell/i18n';
import { AuthStore, parseError } from '@nestfolio/shell';
import { LoadingSkeletonComponent } from '@nestfolio/ui';
import { DashboardStore } from '../stores/dashboard.store';
import { DashboardService } from '../services/dashboard.service';
import { KpiCardsComponent } from './kpi-cards.component';
import { PositionsTableComponent } from './positions-table.component';
import { AllocationChartComponent } from './allocation-chart.component';
import { ActivityFeedComponent } from './activity-feed.component';
import { AdvisoryAlertBarComponent } from './advisory-alert-bar.component';
import { AdvisoryCycleStatusComponent } from './advisory-cycle-status.component';
import { ComparisonCardComponent } from './comparison-card.component';
import { ExecutionModeBadgeComponent } from './execution-mode-badge.component';

const ACTIVITY_RECONNECT_BACKOFF_MS = 2_000;

@Component({
  selector: 'app-dashboard-container',
  standalone: true,
  imports: [
    CommonModule,
    MessageModule,
    LoadingSkeletonComponent,
    KpiCardsComponent,
    PositionsTableComponent,
    AllocationChartComponent,
    ActivityFeedComponent,
    AdvisoryAlertBarComponent,
    AdvisoryCycleStatusComponent,
    ComparisonCardComponent,
    ExecutionModeBadgeComponent,
  ],
  template: `
    @if (store.loading() && !store.isLoaded()) {
      <nf-loading-skeleton [count]="8" />
    } @else {
      <div class="dashboard-grid">
        @if (store.error()) {
          <div class="dashboard-error">
            <p-message severity="error" [text]="i18n.t(store.error()!)" styleClass="w-full" />
          </div>
        }

        <div class="kpi-row">
          <div class="kpi-row-header">
            <app-execution-mode-badge
              [executionMode]="store.investorSnapshot()?.operatingMode ?? null"
            />
          </div>
          <app-kpi-cards
            [portfolioSummary]="store.portfolioSummary()"
            [totalPnl]="store.totalPnl()"
            [advisoryStatus]="store.advisoryStatus()"
          />
        </div>

        <app-advisory-cycle-status
          [generating]="store.advisoryGenerating()"
          [failed]="store.advisoryFailed()"
        />

        <div class="main-content">
          <div class="positions-panel">
            <app-positions-table [positions]="store.positions()" />
          </div>

          <div class="right-panel">
            <app-allocation-chart [allocation]="store.allocationByAssetClass()" />
            @if (store.hasSimulationData()) {
              <app-comparison-card [summary]="store.simulationSummary()" />
            }
            <app-activity-feed [activities]="store.activities()" />
          </div>
        </div>

        @if (store.hasAdvisoryAlerts()) {
          <div class="alert-bar">
            <app-advisory-alert-bar [advisoryStatus]="store.advisoryStatus()" />
          </div>
        }
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }

    .dashboard-grid {
      display: grid;
      grid-template-rows: auto 1fr auto;
      height: 100%;
      gap: 0.75rem;
      padding: 0.75rem;
    }

    .dashboard-error {
      grid-column: 1 / -1;
    }

    .kpi-row {
      grid-column: 1 / -1;
    }

    .kpi-row-header {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 0.5rem;
    }

    .main-content {
      display: grid;
      grid-template-columns: 3fr 2fr;
      gap: 0.75rem;
      min-height: 0;
      overflow: hidden;
    }

    .positions-panel {
      overflow: auto;
      min-height: 0;
    }

    .right-panel {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      overflow: auto;
      min-height: 0;
    }

    .alert-bar {
      grid-column: 1 / -1;
    }

    .w-full { width: 100%; }

    /* Mobile: stack all panels */
    @media (max-width: 768px) {
      .dashboard-grid {
        grid-template-rows: auto;
        height: auto;
        overflow: auto;
      }

      .main-content {
        grid-template-columns: 1fr;
        overflow: visible;
      }

      .positions-panel,
      .right-panel {
        overflow: visible;
      }
    }
  `],
})
export class DashboardContainerComponent implements OnInit, OnDestroy {
  private readonly dashboardService = inject(DashboardService);
  private readonly authStore = inject(AuthStore);
  readonly i18n = inject(I18nService);
  readonly store = inject(DashboardStore);
  private updateSubscription: Subscription | null = null;
  private activitySubscription: Subscription | null = null;
  private nowTickHandle: ReturnType<typeof setInterval> | null = null;

  async ngOnInit(): Promise<void> {
    this.subscribeToUpdates();   // establish subscriptions BEFORE the snapshot query
    this.store.setNow(Date.now());
    this.nowTickHandle = setInterval(() => this.store.setNow(Date.now()), 30_000);
    await this.loadDashboard();  // merge() absorbs any frame that arrived meanwhile
  }

  ngOnDestroy(): void {
    this.updateSubscription?.unsubscribe();
    this.updateSubscription = null;
    this.activitySubscription?.unsubscribe();
    this.activitySubscription = null;
    if (this.nowTickHandle !== null) {
      clearInterval(this.nowTickHandle);
      this.nowTickHandle = null;
    }
  }

  private subscribeToUpdates(): void {
    const tenantId = this.authStore.user()?.tenantId;
    if (!tenantId) return;
    this.updateSubscription = this.dashboardService
      .subscribeToDashboardUpdates(tenantId)
      .subscribe({
        next: (data) => {
          const advisoryStatus = data?.onDashboardUpdate?.advisoryStatus;
          if (advisoryStatus) {
            this.store.setAdvisoryStatus(advisoryStatus);
          }
        },
      });
    this.activitySubscription = this.dashboardService
      .subscribeToActivityUpdates(tenantId)
      .pipe(
        retry({
          delay: () => {
            // WS dropped: re-query to recover rows missed while disconnected,
            // then re-subscribe after a short backoff.
            void this.backfillActivities();
            return timer(ACTIVITY_RECONNECT_BACKOFF_MS);
          },
        }),
      )
      .subscribe({
        next: (data) => {
          const activity = data?.onActivityUpdate?.activity;
          if (activity) {
            this.store.addActivity(activity);
          }
        },
      });
  }

  private async loadDashboard(): Promise<void> {
    this.store.setLoading(true);
    this.store.setError(null);

    try {
      const [dashboard, positions, activities, simulationSummary] = await Promise.all([
        this.dashboardService.getDashboard(),
        this.dashboardService.getPositionSnapshots(),
        this.dashboardService.getRecentActivity(20),
        this.dashboardService.getSimulationSummary(),
      ]);

      this.store.setDashboard(dashboard);
      this.store.setPositions(positions);
      this.store.setActivities(activities);
      this.store.setSimulationSummary(simulationSummary);
    } catch (e: unknown) {
      this.store.setError(parseError(e, 'errors.dashboard'));
    } finally {
      this.store.setLoading(false);
    }
  }

  private async backfillActivities(): Promise<void> {
    try {
      const activities = await this.dashboardService.getRecentActivity(20);
      this.store.mergeActivities(activities);
    } catch {
      // best-effort; the next reconnect or a manual reload recovers
    }
  }
}
