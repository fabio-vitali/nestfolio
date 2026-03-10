import { Injectable, inject } from '@angular/core';
import {
  GraphqlService,
  GET_NOTIFICATIONS,
  GET_UNREAD_COUNT,
  MARK_NOTIFICATION_READ,
} from '@nestfolio/appsync-client';
import type { Notification } from '../stores/notification.store';

export interface NotificationPage {
  items: Notification[];
  nextCursor: string | null;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly graphql = inject(GraphqlService);

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
