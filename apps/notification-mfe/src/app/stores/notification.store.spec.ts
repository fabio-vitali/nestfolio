import { TestBed } from '@angular/core/testing';
import { NotificationStore, Notification } from './notification.store';
import { LogoutOrchestrator } from '@nestfolio/shared-state';

const makeNotification = (id: string, status = 'CREATED'): Notification => ({
  notificationId: id,
  tenantId: 'tenant-1',
  channel: 'IN_APP',
  title: `Notification ${id}`,
  body: `Body for ${id}`,
  status,
  relatedEntityType: 'DECISION',
  relatedEntityId: 'dec-001',
  createdAt: '2026-03-01T10:00:00Z',
  sentAt: null,
  deliveredAt: null,
  readAt: status === 'READ' ? '2026-03-01T11:00:00Z' : null,
});

describe('NotificationStore', () => {
  let store: InstanceType<typeof NotificationStore>;
  let orchestrator: LogoutOrchestrator;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(NotificationStore);
    orchestrator = TestBed.inject(LogoutOrchestrator);
    store.reset();
  });

  it('should start with initial state', () => {
    expect(store.notifications()).toEqual([]);
    expect(store.unreadCount()).toBe(0);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(store.nextCursor()).toBeNull();
  });

  it('should set notifications', () => {
    const items = [makeNotification('n-001'), makeNotification('n-002')];
    store.setNotifications(items, 'cursor-abc');

    expect(store.notifications()).toHaveLength(2);
    expect(store.nextCursor()).toBe('cursor-abc');
    expect(store.hasMore()).toBe(true);
  });

  it('should append notifications', () => {
    store.setNotifications([makeNotification('n-001')], 'cursor-1');
    store.appendNotifications([makeNotification('n-002')], null);

    expect(store.notifications()).toHaveLength(2);
    expect(store.hasMore()).toBe(false);
  });

  it('should set unread count', () => {
    store.setUnreadCount(5);
    expect(store.unreadCount()).toBe(5);
  });

  it('should mark notification as read', () => {
    store.setNotifications([makeNotification('n-001'), makeNotification('n-002')], null);
    store.setUnreadCount(2);

    store.markRead('n-001');

    const n = store.notifications().find((x) => x.notificationId === 'n-001');
    expect(n?.status).toBe('READ');
    expect(n?.readAt).not.toBeNull();
    expect(store.unreadCount()).toBe(1);
  });

  it('should not go below zero unread count', () => {
    store.setUnreadCount(0);
    store.setNotifications([makeNotification('n-001', 'READ')], null);

    store.markRead('n-001');

    expect(store.unreadCount()).toBe(0);
  });

  it('should compute isEmpty', () => {
    expect(store.isEmpty()).toBe(true);

    store.setNotifications([makeNotification('n-001')], null);
    expect(store.isEmpty()).toBe(false);
  });

  it('should not be empty while loading', () => {
    store.setLoading(true);
    expect(store.isEmpty()).toBe(false);
  });

  it('should set loading', () => {
    store.setLoading(true);
    expect(store.loading()).toBe(true);
  });

  it('should set loading more', () => {
    store.setLoadingMore(true);
    expect(store.loadingMore()).toBe(true);
  });

  it('should set error', () => {
    store.setError('Network failed');
    expect(store.error()).toBe('Network failed');
  });

  it('should reset to initial state', () => {
    store.setNotifications([makeNotification('n-001')], 'cursor');
    store.setUnreadCount(3);
    store.setLoading(true);
    store.setError('err');

    store.reset();

    expect(store.notifications()).toEqual([]);
    expect(store.unreadCount()).toBe(0);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(store.nextCursor()).toBeNull();
  });

  it('should reset on logout via orchestrator', () => {
    store.setNotifications([makeNotification('n-001')], 'cursor');
    store.setUnreadCount(3);
    store.setLoading(true);

    orchestrator.resetAll();

    expect(store.notifications()).toEqual([]);
    expect(store.unreadCount()).toBe(0);
    expect(store.loading()).toBe(false);
    expect(store.nextCursor()).toBeNull();
  });

  it('should expose callState-based loading/error signals', () => {
    store.setLoading(true);
    expect(store.loading()).toBe(true);

    store.setLoading(false);
    expect(store.loaded()).toBe(true);

    store.setError('fail');
    expect(store.error()).toBe('fail');
  });
});
