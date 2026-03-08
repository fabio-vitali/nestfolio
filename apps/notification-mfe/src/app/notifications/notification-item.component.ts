import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RelativeTimePipe } from '@nestfolio/ui-components';
import type { Notification } from '../stores/notification.store';

@Component({
  selector: 'app-notification-item',
  standalone: true,
  imports: [CommonModule, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="notification-item"
      [class.notification-item--unread]="notification().status !== 'READ'"
      (click)="onTap()"
    >
      <div class="notification-icon">
        <span class="icon-dot" [class.icon-dot--unread]="notification().status !== 'READ'"></span>
      </div>
      <div class="notification-body">
        <p class="notification-title">{{ notification().title }}</p>
        <p class="notification-text">{{ notification().body }}</p>
        <span class="notification-time">{{ notification().createdAt | relativeTime }}</span>
      </div>
      @if (notification().status !== 'READ') {
        <button
          class="mark-read-btn"
          type="button"
          (click)="onMarkRead($event)"
          aria-label="Mark as read"
        >
          &check;
        </button>
      }
    </div>
  `,
  styles: [`
    .notification-item {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--p-surface-100);
      cursor: pointer;
      transition: background 0.15s;
    }

    .notification-item:hover {
      background: var(--p-surface-50);
    }

    .notification-item--unread {
      background: var(--p-blue-50);
    }

    .notification-item--unread:hover {
      background: var(--p-blue-100);
    }

    .notification-icon {
      flex-shrink: 0;
      padding-top: 0.25rem;
    }

    .icon-dot {
      display: block;
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
      background: var(--p-surface-300);
    }

    .icon-dot--unread {
      background: var(--p-blue-500);
    }

    .notification-body {
      flex: 1;
      min-width: 0;
    }

    .notification-title {
      margin: 0;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--p-surface-800);
    }

    .notification-text {
      margin: 0.125rem 0 0;
      font-size: 0.8125rem;
      color: var(--p-surface-600);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .notification-time {
      font-size: 0.6875rem;
      color: var(--p-surface-400);
    }

    .mark-read-btn {
      flex-shrink: 0;
      border: none;
      background: none;
      cursor: pointer;
      color: var(--p-blue-500);
      font-size: 1rem;
      padding: 0.25rem;
      border-radius: 0.25rem;
      transition: background 0.15s;
    }

    .mark-read-btn:hover {
      background: var(--p-blue-100);
    }
  `],
})
export class NotificationItemComponent {
  notification = input.required<Notification>();
  markRead = output<string>();
  tap = output<Notification>();

  onMarkRead(event: Event): void {
    event.stopPropagation();
    this.markRead.emit(this.notification().notificationId);
  }

  onTap(): void {
    this.tap.emit(this.notification());
  }
}
