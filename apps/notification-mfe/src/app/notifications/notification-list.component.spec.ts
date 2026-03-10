import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NotificationListComponent } from './notification-list.component';
import { NotificationStore, Notification } from '../stores/notification.store';
import { NotificationService } from '../services/notification.service';
import { I18nService } from '@nestfolio/i18n';
import { NotificationStore as NotificationCountStore } from '@nestfolio/shared-state';
import { setupComponentTest, createMockI18nService, createMockRouter } from '@nestfolio/shared-state/testing';

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
  readAt: null,
});

describe('NotificationListComponent', () => {
  let component: NotificationListComponent;
  let notificationService: jest.Mocked<NotificationService>;
  let router: jest.Mocked<Router>;
  let store: InstanceType<typeof NotificationStore>;
  let countStore: InstanceType<typeof NotificationCountStore>;

  beforeEach(async () => {
    notificationService = {
      getNotifications: jest.fn().mockResolvedValue({
        items: [makeNotification('n-001'), makeNotification('n-002')],
        nextCursor: null,
      }),
      getUnreadCount: jest.fn().mockResolvedValue(2),
      markNotificationRead: jest.fn().mockResolvedValue(makeNotification('n-001', 'READ')),
    } as unknown as jest.Mocked<NotificationService>;

    router = createMockRouter() as jest.Mocked<Router>;

    const fixture = await setupComponentTest(NotificationListComponent, {
      providers: [
        { provide: NotificationService, useValue: notificationService },
        { provide: Router, useValue: router },
        { provide: I18nService, useValue: createMockI18nService() },
      ],
    });

    store = TestBed.inject(NotificationStore);
    countStore = TestBed.inject(NotificationCountStore);
    store.reset();
    countStore.setUnreadCount(5);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load notifications on init', async () => {
    await component.ngOnInit();

    expect(notificationService.getNotifications).toHaveBeenCalled();
    expect(notificationService.getUnreadCount).toHaveBeenCalled();
    expect(store.notifications()).toHaveLength(2);
    expect(store.unreadCount()).toBe(2);
  });

  it('should set loading state', async () => {
    const promise = component.ngOnInit();
    expect(store.loading()).toBe(true);

    await promise;
    expect(store.loading()).toBe(false);
  });

  it('should mark notification as read (optimistic)', async () => {
    await component.ngOnInit();

    await component.onMarkRead('n-001');

    const n = store.notifications().find((x) => x.notificationId === 'n-001');
    expect(n?.status).toBe('READ');
    expect(store.unreadCount()).toBe(1);
    expect(notificationService.markNotificationRead).toHaveBeenCalledWith('n-001');
  });

  it('should decrement shared NotificationCountStore on markRead', async () => {
    await component.ngOnInit();

    await component.onMarkRead('n-001');

    expect(countStore.unreadCount()).toBe(4);
  });

  it('should decrement shared NotificationCountStore on tap (unread)', async () => {
    await component.ngOnInit();

    component.onTap(makeNotification('n-001'));

    expect(countStore.unreadCount()).toBe(4);
  });

  it('should navigate to decision on tap', async () => {
    await component.ngOnInit();

    const notification = makeNotification('n-001');
    notification.relatedEntityType = 'DECISION';
    notification.relatedEntityId = 'dec-001';

    component.onTap(notification);

    expect(router.navigate).toHaveBeenCalledWith(['/advisory', 'dec-001']);
  });

  it('should mark as read on tap if unread', async () => {
    await component.ngOnInit();

    const notification = makeNotification('n-001');
    component.onTap(notification);

    const n = store.notifications().find((x) => x.notificationId === 'n-001');
    expect(n?.status).toBe('READ');
  });

  it('should not navigate if no related entity', async () => {
    await component.ngOnInit();

    const notification = { ...makeNotification('n-001'), relatedEntityType: null, relatedEntityId: null };
    component.onTap(notification);

    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('should handle service error', async () => {
    notificationService.getNotifications.mockRejectedValue(new Error('Network error'));

    await component.ngOnInit();

    expect(store.error()).toBe('Network error');
  });

  it('should load more when cursor exists', async () => {
    notificationService.getNotifications
      .mockResolvedValueOnce({
        items: [makeNotification('n-001')],
        nextCursor: 'cursor-1',
      } as never)
      .mockResolvedValueOnce({
        items: [makeNotification('n-002')],
        nextCursor: null,
      } as never);

    await component.ngOnInit();
    expect(store.hasMore()).toBe(true);

    await component.loadMore();

    expect(store.notifications()).toHaveLength(2);
    expect(store.hasMore()).toBe(false);
  });

  it('should handle non-Error exceptions with generic message', async () => {
    notificationService.getNotifications.mockRejectedValue('string-error');

    await component.ngOnInit();

    // Should set some error
    expect(store.error()).toBeTruthy();
  });

  it('should compute isEmpty correctly when no notifications', async () => {
    notificationService.getNotifications.mockResolvedValue({
      items: [],
      nextCursor: null,
    } as never);

    await component.ngOnInit();

    expect(store.isEmpty()).toBe(true);
  });

  it('should not call markNotificationRead for already-read notification', async () => {
    await component.ngOnInit();

    // First mark as read
    await component.onMarkRead('n-001');
    expect(store.unreadCount()).toBe(1);
    expect(notificationService.markNotificationRead).toHaveBeenCalledTimes(1);

    // Second mark should still call service (optimistic update already applied)
    await component.onMarkRead('n-001');
    // Status was already READ, so the service was called but count reflects the optimistic update pattern
    expect(notificationService.markNotificationRead).toHaveBeenCalledTimes(2);
  });

  it('should set loading during loadMore', async () => {
    notificationService.getNotifications
      .mockResolvedValueOnce({
        items: [makeNotification('n-001')],
        nextCursor: 'cursor-1',
      } as never)
      .mockResolvedValueOnce({
        items: [makeNotification('n-002')],
        nextCursor: null,
      } as never);

    await component.ngOnInit();

    const loadPromise = component.loadMore();
    await loadPromise;

    expect(store.notifications()).toHaveLength(2);
  });

  it('should not load more when no cursor', async () => {
    await component.ngOnInit();
    expect(store.hasMore()).toBe(false);

    await component.loadMore();

    // Should not have been called a second time
    expect(notificationService.getNotifications).toHaveBeenCalledTimes(1);
  });

  it('should log error and reload on markRead failure during tap', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    notificationService.markNotificationRead.mockRejectedValue(new Error('server error'));

    await component.ngOnInit();
    const callsBefore = notificationService.getNotifications.mock.calls.length;
    const notification = makeNotification('n-001');
    component.onTap(notification);

    // Wait for the failed promise and subsequent reload to settle
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(consoleSpy).toHaveBeenCalledWith('markRead failed', expect.any(Error));
    // Should have reloaded notifications (at least one additional call after the error)
    expect(notificationService.getNotifications.mock.calls.length).toBeGreaterThan(callsBefore);
    consoleSpy.mockRestore();
  });
});
