import { TestBed } from '@angular/core/testing';
import { GraphqlService } from '@nestfolio/appsync-client';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;
  let graphql: jest.Mocked<GraphqlService>;

  beforeEach(() => {
    graphql = { query: jest.fn(), mutate: jest.fn(), subscribe: jest.fn(), resetClient: jest.fn() } as any;
    TestBed.configureTestingModule({
      providers: [{ provide: GraphqlService, useValue: graphql }],
    });
    service = TestBed.inject(NotificationService);
  });

  it('should call getNotifications without params', async () => {
    const page = { items: [], nextCursor: null };
    graphql.query.mockResolvedValue({ getNotifications: page });

    const result = await service.getNotifications();
    expect(result).toEqual(page);
    expect(graphql.query).toHaveBeenCalledWith(expect.any(String), undefined);
  });

  it('should call getNotifications with limit and cursor', async () => {
    const page = { items: [{ notificationId: 'n-001' }], nextCursor: 'abc' };
    graphql.query.mockResolvedValue({ getNotifications: page });

    const result = await service.getNotifications(10, 'prev-cursor');
    expect(result).toEqual(page);
    expect(graphql.query).toHaveBeenCalledWith(expect.any(String), { limit: 10, cursor: 'prev-cursor' });
  });

  it('should call getUnreadCount', async () => {
    graphql.query.mockResolvedValue({ getUnreadCount: 3 });

    const result = await service.getUnreadCount();
    expect(result).toBe(3);
  });

  it('should call markNotificationRead', async () => {
    const notification = { notificationId: 'n-001', status: 'READ' };
    graphql.mutate.mockResolvedValue({ markNotificationRead: notification });

    const result = await service.markNotificationRead('n-001');
    expect(result).toEqual(notification);
    expect(graphql.mutate).toHaveBeenCalledWith(expect.any(String), { notificationId: 'n-001' });
  });

  it('should throw when markNotificationRead returns null', async () => {
    graphql.mutate.mockResolvedValue({ markNotificationRead: null });

    await expect(service.markNotificationRead('n-001')).rejects.toThrow('Failed to mark notification as read');
  });
});
