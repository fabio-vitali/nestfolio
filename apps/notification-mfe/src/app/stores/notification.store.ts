import { computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';

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
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  nextCursor: string | null;
}

const initialState: NotificationState = {
  notifications: [],
  unreadCount: 0,
  loading: false,
  loadingMore: false,
  error: null,
  nextCursor: null,
};

export const NotificationStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((store) => ({
    hasMore: computed(() => store.nextCursor() !== null),
    isEmpty: computed(() => !store.loading() && store.notifications().length === 0),
  })),
  withMethods((store) => ({
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
      const updated = store.notifications().map((n) =>
        n.notificationId === notificationId
          ? { ...n, status: 'READ', readAt: new Date().toISOString() }
          : n,
      );
      patchState(store, {
        notifications: updated,
        unreadCount: Math.max(0, store.unreadCount() - 1),
      });
    },
    setLoading(loading: boolean): void {
      patchState(store, { loading });
    },
    setLoadingMore(loadingMore: boolean): void {
      patchState(store, { loadingMore });
    },
    setError(error: string | null): void {
      patchState(store, { error });
    },
    reset(): void {
      patchState(store, { ...initialState });
    },
  })),
);
