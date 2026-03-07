import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NotificationListComponent } from './notification-list.component';
import { NotificationStore, Notification } from '../stores/notification.store';
import { NotificationService } from '../services/notification.service';
import { I18nService } from '@nestfolio/i18n';

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

  beforeEach(async () => {
    notificationService = {
      getNotifications: jest.fn().mockResolvedValue({
        items: [makeNotification('n-001'), makeNotification('n-002')],
        nextCursor: null,
      }),
      getUnreadCount: jest.fn().mockResolvedValue(2),
      markNotificationRead: jest.fn().mockResolvedValue(makeNotification('n-001', 'READ')),
    } as unknown as jest.Mocked<NotificationService>;

    router = { navigate: jest.fn() } as unknown as jest.Mocked<Router>;

    await TestBed.configureTestingModule({
      imports: [NotificationListComponent],
      providers: [
        { provide: NotificationService, useValue: notificationService },
        { provide: Router, useValue: router },
        { provide: I18nService, useValue: { t: (k: string) => k } },
      ],
    })
      .overrideComponent(NotificationListComponent, {
        set: { template: '<div>test</div>', imports: [], styles: [] },
      })
      .compileComponents();

    store = TestBed.inject(NotificationStore);
    store.reset();
    const fixture = TestBed.createComponent(NotificationListComponent);
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

  it('should not load more when no cursor', async () => {
    await component.ngOnInit();
    expect(store.hasMore()).toBe(false);

    await component.loadMore();

    // Should not have been called a second time
    expect(notificationService.getNotifications).toHaveBeenCalledTimes(1);
  });
});
