import { Component, inject, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { LoadingSkeletonComponent, EmptyStateComponent } from '@nestfolio/ui-components';
import { I18nService } from '@nestfolio/i18n';
import { NotificationStore, Notification } from '../stores/notification.store';
import { NotificationService } from '../services/notification.service';
import { NotificationItemComponent } from './notification-item.component';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-notification-list',
  standalone: true,
  imports: [
    CommonModule,
    TranslateModule,
    MessageModule,
    ButtonModule,
    LoadingSkeletonComponent,
    EmptyStateComponent,
    NotificationItemComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.loading() && store.notifications().length === 0) {
      <nf-loading-skeleton [count]="6" />
    } @else {
      <div class="notification-list">
        <div class="list-header">
          <h2 class="list-title">{{ 'notifications.title' | translate }}</h2>
          @if (store.unreadCount() > 0) {
            <span class="unread-badge">{{ store.unreadCount() }}</span>
          }
        </div>

        @if (store.error()) {
          <p-message severity="error" [text]="store.error()!" styleClass="w-full" />
        }

        @if (store.isEmpty()) {
          <nf-empty-state
            [title]="'notifications.empty' | translate"
            [message]="'notifications.emptyHint' | translate"
          />
        } @else {
          <div class="notifications">
            @for (notification of store.notifications(); track notification.notificationId) {
              <app-notification-item
                [notification]="notification"
                (markRead)="onMarkRead($event)"
                (tap)="onTap(notification)"
              />
            }
          </div>

          @if (store.hasMore()) {
            <div class="load-more">
              <p-button
                [label]="'notifications.loadMore' | translate"
                [loading]="store.loadingMore()"
                severity="secondary"
                [outlined]="true"
                (onClick)="loadMore()"
                styleClass="w-full"
              />
            </div>
          }
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }

    .notification-list {
      max-width: 40rem;
      margin: 0 auto;
    }

    .list-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--p-surface-200);
    }

    .list-title {
      margin: 0;
      font-size: 1.125rem;
      font-weight: 700;
      color: var(--p-surface-900);
    }

    .unread-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.25rem;
      height: 1.25rem;
      padding: 0 0.375rem;
      border-radius: 0.625rem;
      background: var(--p-blue-500);
      color: white;
      font-size: 0.6875rem;
      font-weight: 700;
    }

    .load-more {
      padding: 0.75rem 1rem;
    }

    .w-full { width: 100%; }
  `],
})
export class NotificationListComponent implements OnInit {
  private notificationService = inject(NotificationService);
  private router = inject(Router);
  readonly i18n = inject(I18nService);
  readonly store = inject(NotificationStore);

  async ngOnInit(): Promise<void> {
    await this.loadNotifications();
  }

  async onMarkRead(notificationId: string): Promise<void> {
    this.store.markRead(notificationId);
    try {
      await this.notificationService.markNotificationRead(notificationId);
    } catch {
      // Optimistic update already applied; reload on error
      await this.loadNotifications();
    }
  }

  onTap(notification: Notification): void {
    if (notification.status !== 'READ') {
      this.store.markRead(notification.notificationId);
      this.notificationService.markNotificationRead(notification.notificationId).catch((err) => {
        console.error('markRead failed', err);
        // Revert optimistic update by reloading
        this.loadNotifications();
      });
    }

    if (notification.relatedEntityType === 'DECISION' && notification.relatedEntityId) {
      this.router.navigate(['/advisory', notification.relatedEntityId]);
    }
  }

  async loadMore(): Promise<void> {
    const cursor = this.store.nextCursor();
    if (!cursor) return;

    this.store.setLoadingMore(true);
    try {
      const page = await this.notificationService.getNotifications(PAGE_SIZE, cursor);
      this.store.appendNotifications(page.items, page.nextCursor);
    } catch (e: unknown) {
      this.store.setError(e instanceof Error ? e.message : 'Failed to load more');
    } finally {
      this.store.setLoadingMore(false);
    }
  }

  private async loadNotifications(): Promise<void> {
    this.store.setLoading(true);
    this.store.setError(null);

    try {
      const [page, unreadCount] = await Promise.all([
        this.notificationService.getNotifications(PAGE_SIZE),
        this.notificationService.getUnreadCount(),
      ]);

      this.store.setNotifications(page.items, page.nextCursor);
      this.store.setUnreadCount(unreadCount);
    } catch (e: unknown) {
      this.store.setError(e instanceof Error ? e.message : 'Failed to load notifications');
    } finally {
      this.store.setLoading(false);
    }
  }
}
