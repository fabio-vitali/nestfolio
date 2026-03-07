import { TestBed } from '@angular/core/testing';
import { NotificationService } from './notification.service';

jest.mock('@nestfolio/appsync-client', () => ({
  query: jest.fn(),
  mutate: jest.fn(),
  GET_NOTIFICATIONS: 'GET_NOTIFICATIONS',
  GET_UNREAD_COUNT: 'GET_UNREAD_COUNT',
  MARK_NOTIFICATION_READ: 'MARK_NOTIFICATION_READ',
}));

import { query, mutate } from '@nestfolio/appsync-client';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockMutate = mutate as jest.MockedFunction<typeof mutate>;

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(NotificationService);
    jest.clearAllMocks();
  });

  it('should call getNotifications without params', async () => {
    const page = { items: [], nextCursor: null };
    mockQuery.mockResolvedValue({ getNotifications: page } as never);

    const result = await service.getNotifications();
    expect(result).toEqual(page);
    expect(mockQuery).toHaveBeenCalledWith('GET_NOTIFICATIONS', undefined);
  });

  it('should call getNotifications with limit and cursor', async () => {
    const page = { items: [{ notificationId: 'n-001' }], nextCursor: 'abc' };
    mockQuery.mockResolvedValue({ getNotifications: page } as never);

    const result = await service.getNotifications(10, 'prev-cursor');
    expect(result).toEqual(page);
    expect(mockQuery).toHaveBeenCalledWith('GET_NOTIFICATIONS', { limit: 10, cursor: 'prev-cursor' });
  });

  it('should call getUnreadCount', async () => {
    mockQuery.mockResolvedValue({ getUnreadCount: 3 } as never);

    const result = await service.getUnreadCount();
    expect(result).toBe(3);
  });

  it('should call markNotificationRead', async () => {
    const notification = { notificationId: 'n-001', status: 'READ' };
    mockMutate.mockResolvedValue({ markNotificationRead: notification } as never);

    const result = await service.markNotificationRead('n-001');
    expect(result).toEqual(notification);
    expect(mockMutate).toHaveBeenCalledWith('MARK_NOTIFICATION_READ', { notificationId: 'n-001' });
  });
});
