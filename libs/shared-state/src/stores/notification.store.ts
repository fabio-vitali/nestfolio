import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';

interface NotificationState {
  unreadCount: number;
}

const initialState: NotificationState = {
  unreadCount: 0,
};

export const NotificationStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store) => ({
    setUnreadCount(count: number): void {
      patchState(store, { unreadCount: count });
    },
    incrementUnread(): void {
      patchState(store, { unreadCount: store.unreadCount() + 1 });
    },
    decrementUnread(): void {
      patchState(store, { unreadCount: Math.max(0, store.unreadCount() - 1) });
    },
  })),
);
