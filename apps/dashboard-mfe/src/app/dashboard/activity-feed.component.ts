import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { I18nService } from '@nestfolio/shell/i18n';
import { RelativeTimePipe } from '@nestfolio/ui';
import type { ActivityEntry } from '../stores/dashboard.store';

@Component({
  selector: 'app-activity-feed',
  standalone: true,
  imports: [CommonModule, CardModule, RelativeTimePipe],
  template: `
    <p-card [header]="i18n.t('dashboard.activity.recentActivity')" styleClass="activity-card">
      @if (activities.length === 0) {
        <div class="no-data">{{ i18n.t('dashboard.activity.noActivity') }}</div>
      } @else {
        <div class="activity-list">
          @for (activity of activities; track activity.activityId) {
            <div class="activity-item" [attr.data-activity-id]="activity.activityId">
              <span class="activity-icon" [class]="getIconClass(activity.activityType)"></span>
              <div class="activity-content">
                <div class="activity-desc">{{ activity.description }}</div>
                <div class="activity-time">{{ activity.createdAt | relativeTime }}</div>
              </div>
            </div>
          }
        </div>
      }
    </p-card>
  `,
  styles: [`
    .no-data {
      text-align: center;
      color: var(--nf-text-secondary, #6c757d);
      padding: 1rem 0;
    }

    .activity-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .activity-item {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      padding: 0.375rem 0;
      border-bottom: 1px solid var(--nf-bg-secondary, #e9ecef);
    }

    .activity-item:last-child {
      border-bottom: none;
    }

    .activity-icon {
      font-size: 0.875rem;
      margin-top: 2px;
      color: var(--nf-text-secondary, #6c757d);
    }

    .activity-content {
      flex: 1;
      min-width: 0;
    }

    .activity-desc {
      font-size: 0.8rem;
      color: var(--nf-text-primary, #212529);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .activity-time {
      font-size: 0.7rem;
      color: var(--nf-text-secondary, #6c757d);
    }
  `],
})
export class ActivityFeedComponent {
  readonly i18n = inject(I18nService);
  @Input() activities: ActivityEntry[] = [];

  private readonly ICON_MAP: Record<string, string> = {
    ORDER_FILLED: 'pi pi-check-circle',
    ORDER_PARTIALLY_FILLED: 'pi pi-check',
    DECISION_APPROVED: 'pi pi-thumbs-up',
    DECISION_BLOCKED: 'pi pi-ban',
    DEPOSIT_DETECTED: 'pi pi-arrow-down',
    WITHDRAWAL_COMPLETED: 'pi pi-arrow-up',
  };

  getIconClass(activityType: string): string {
    return this.ICON_MAP[activityType] ?? 'pi pi-circle';
  }
}
