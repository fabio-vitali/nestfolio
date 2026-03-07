import { Injectable } from '@angular/core';
import {
  query,
  mutate,
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
  async getNotifications(limit?: number, cursor?: string): Promise<NotificationPage> {
    const variables: Record<string, unknown> = {};
    if (limit !== undefined) variables['limit'] = limit;
    if (cursor !== undefined) variables['cursor'] = cursor;

    const data = await query<{ getNotifications: NotificationPage }>(
      GET_NOTIFICATIONS,
      Object.keys(variables).length > 0 ? variables : undefined,
    );
    return data.getNotifications;
  }

  async getUnreadCount(): Promise<number> {
    const data = await query<{ getUnreadCount: number }>(GET_UNREAD_COUNT);
    return data.getUnreadCount;
  }

  async markNotificationRead(notificationId: string): Promise<Notification> {
    const data = await mutate<{ markNotificationRead: Notification }>(
      MARK_NOTIFICATION_READ,
      { notificationId },
    );
    return data.markNotificationRead;
  }
}
