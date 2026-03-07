import { TestBed } from '@angular/core/testing';
import { NotificationStore } from './notification.store';

describe('NotificationStore', () => {
  let store: InstanceType<typeof NotificationStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(NotificationStore);
  });

  it('should start with zero unread count', () => {
    expect(store.unreadCount()).toBe(0);
  });

  it('should set unread count', () => {
    store.setUnreadCount(5);
    expect(store.unreadCount()).toBe(5);
  });

  it('should increment unread', () => {
    store.incrementUnread();
    store.incrementUnread();
    expect(store.unreadCount()).toBe(2);
  });

  it('should decrement unread but not below zero', () => {
    store.setUnreadCount(1);
    store.decrementUnread();
    expect(store.unreadCount()).toBe(0);
    store.decrementUnread();
    expect(store.unreadCount()).toBe(0);
  });
});
