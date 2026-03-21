import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import {
  setError as callError,
  setLoading as callLoading,
  withCallState,
  withDevtools,
  withLogoutReset,
} from '@nestfolio/shell';

export interface Notification {
  notificationId: string;
  tenantId: string;
  channel: string;
  title: string;
  body: string;
  status: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
}

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  loadingMore: boolean;
  nextCursor: string | null;
}

const initialState: NotificationState = {
  notifications: [],
  unreadCount: 0,
  loadingMore: false,
  nextCursor: null,
};

export const NotificationStore = signalStore(
  withState(initialState),
  withCallState(),
  withComputed((store) => ({
    hasMore: computed(() => store.nextCursor() !== null),
    isEmpty: computed(() => !store.loading() && store.notifications().length === 0),
  })),
  withMethods((store) => ({
    prependNotification(notification: Notification): void {
      if (store.notifications().some(n => n.notificationId === notification.notificationId)) return;
      patchState(store, {
        notifications: [notification, ...store.notifications()],
        unreadCount: store.unreadCount() + 1,
      });
    },
    setNotifications(notifications: Notification[], nextCursor: string | null): void {
      patchState(store, { notifications, nextCursor });
    },
    appendNotifications(notifications: Notification[], nextCursor: string | null): void {
      patchState(store, {
        notifications: [...store.notifications(), ...notifications],
        nextCursor,
      });
    },
    setUnreadCount(unreadCount: number): void {
      patchState(store, { unreadCount });
    },
    markRead(notificationId: string): void {
      const updated = store
        .notifications()
        .map((n) =>
          n.notificationId === notificationId
            ? { ...n, status: 'READ', readAt: new Date().toISOString() }
            : n,
        );
      patchState(store, {
        notifications: updated,
        unreadCount: Math.max(0, store.unreadCount() - 1),
      });
    },
    setLoading(v: boolean): void {
      if (v) {
        patchState(store, callLoading());
      } else {
        patchState(store, {
          callState: store.callError() ? ('error' as const) : ('loaded' as const),
        });
      }
    },
    setLoadingMore(loadingMore: boolean): void {
      patchState(store, { loadingMore });
    },
    setError(error: string | null): void {
      if (error) {
        patchState(store, callError(error));
      } else {
        patchState(store, { callError: null });
      }
    },
    reset(): void {
      patchState(store, { ...initialState, callState: 'init', callError: null });
    },
  })),
  withLogoutReset(() => ({
    ...initialState,
    callState: 'init' as const,
    callError: null,
  })),
  withDevtools('NotificationStore'),
);
