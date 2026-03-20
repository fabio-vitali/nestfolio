import { Injectable, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { GraphqlService } from '@nestfolio/appsync-client';
import {
  GET_NOTIFICATIONS,
  GET_UNREAD_COUNT,
  MARK_NOTIFICATION_READ,
  ON_NOTIFICATION,
} from '../graphql/investor-bff.queries';
import type { Notification } from '../stores/notification.store';

export interface NotificationPage {
  items: Notification[];
  nextCursor: string | null;
}

@Injectable()
export class NotificationService {
  private readonly graphql = inject(GraphqlService);
  private subscription: Subscription | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private static readonly MAX_RECONNECT_ATTEMPTS = 5;

  subscribeToNotifications(
    onNotification: (notification: Notification) => void,
  ): void {
    this.unsubscribeFromNotifications();
    this.reconnectAttempts = 0;
    this.doSubscribe(onNotification);
  }

  private doSubscribe(
    onNotification: (notification: Notification) => void,
  ): void {
    const obs = this.graphql.subscribe<{ onNotification: Notification }>(ON_NOTIFICATION);
    this.subscription = obs.subscribe({
      next: (data) => {
        if (data.onNotification) {
          this.reconnectAttempts = 0;
          onNotification(data.onNotification);
        }
      },
      error: (err) => {
        // eslint-disable-next-line no-console
        console.error('Notification subscription error', err);
        if (this.reconnectAttempts < NotificationService.MAX_RECONNECT_ATTEMPTS) {
          this.reconnectAttempts++;
          const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts - 1), 30_000);
          this.reconnectTimeout = setTimeout(() => this.doSubscribe(onNotification), delay);
        }
      },
    });
  }

  unsubscribeFromNotifications(): void {
    if (this.reconnectTimeout !== null) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.reconnectAttempts = 0;
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  async getNotifications(limit?: number, cursor?: string): Promise<NotificationPage> {
    const variables: Record<string, unknown> = {};
    if (limit !== undefined) variables['limit'] = limit;
    if (cursor !== undefined) variables['cursor'] = cursor;

    const data = await this.graphql.query<{ getNotifications: NotificationPage | null }>(
      GET_NOTIFICATIONS,
      Object.keys(variables).length > 0 ? variables : undefined,
    );
    return data.getNotifications ?? { items: [], nextCursor: null };
  }

  async getUnreadCount(): Promise<number> {
    const data = await this.graphql.query<{ getUnreadCount: number | null }>(GET_UNREAD_COUNT);
    return data.getUnreadCount ?? 0;
  }

  async markNotificationRead(notificationId: string): Promise<Notification> {
    const data = await this.graphql.mutate<{ markNotificationRead: Notification | null }>(
      MARK_NOTIFICATION_READ,
      { notificationId },
    );
    if (!data.markNotificationRead) throw new Error('Failed to mark notification as read');
    return data.markNotificationRead;
  }
}
