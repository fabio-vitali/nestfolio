import { TestBed } from '@angular/core/testing';
import { GraphqlService } from '@nestfolio/appsync-client';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;
  let graphql: jest.Mocked<GraphqlService>;

  beforeEach(() => {
    jest.useFakeTimers();
    graphql = { query: jest.fn(), mutate: jest.fn(), subscribe: jest.fn(), resetClient: jest.fn() } as any;
    TestBed.configureTestingModule({
      providers: [{ provide: GraphqlService, useValue: graphql }],
    });
    service = TestBed.inject(NotificationService);
  });

  afterEach(() => {
    jest.useRealTimers();
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

  it('should subscribe to notifications', () => {
    const mockUnsubscribe = jest.fn();
    const mockSubscribe = jest.fn().mockReturnValue({ unsubscribe: mockUnsubscribe });
    graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

    service.subscribeToNotifications(jest.fn());

    expect(graphql.subscribe).toHaveBeenCalledWith(expect.any(String));
    expect(mockSubscribe).toHaveBeenCalled();
  });

  it('should unsubscribe from notifications', () => {
    const mockUnsubscribe = jest.fn();
    const mockSubscribe = jest.fn().mockReturnValue({ unsubscribe: mockUnsubscribe });
    graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

    service.subscribeToNotifications(jest.fn());
    service.unsubscribeFromNotifications();

    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('should unsubscribe previous subscription when subscribing again', () => {
    const mockUnsubscribe1 = jest.fn();
    const mockUnsubscribe2 = jest.fn();
    graphql.subscribe
      .mockReturnValueOnce({ subscribe: jest.fn().mockReturnValue({ unsubscribe: mockUnsubscribe1 }) } as any)
      .mockReturnValueOnce({ subscribe: jest.fn().mockReturnValue({ unsubscribe: mockUnsubscribe2 }) } as any);

    service.subscribeToNotifications(jest.fn());
    service.subscribeToNotifications(jest.fn());

    expect(mockUnsubscribe1).toHaveBeenCalled();
  });

  it('should not throw when unsubscribing without active subscription', () => {
    expect(() => service.unsubscribeFromNotifications()).not.toThrow();
  });

  it('should reconnect with exponential backoff after subscription error', () => {
    let errorHandler!: (err: Error) => void;
    const mockSubscribe = jest.fn().mockImplementation((handlers: any) => {
      errorHandler = handlers.error;
      return { unsubscribe: jest.fn() };
    });
    graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

    service.subscribeToNotifications(jest.fn());
    expect(graphql.subscribe).toHaveBeenCalledTimes(1);

    // First error → reconnect after 5s
    errorHandler(new Error('connection lost'));
    expect(graphql.subscribe).toHaveBeenCalledTimes(1); // not yet
    jest.advanceTimersByTime(5000);
    expect(graphql.subscribe).toHaveBeenCalledTimes(2);

    // Second error → reconnect after 10s
    errorHandler(new Error('connection lost'));
    jest.advanceTimersByTime(9999);
    expect(graphql.subscribe).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(1);
    expect(graphql.subscribe).toHaveBeenCalledTimes(3);
  });

  it('should stop reconnecting after MAX_RECONNECT_ATTEMPTS', () => {
    let errorHandler!: (err: Error) => void;
    const mockSubscribe = jest.fn().mockImplementation((handlers: any) => {
      errorHandler = handlers.error;
      return { unsubscribe: jest.fn() };
    });
    graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    service.subscribeToNotifications(jest.fn());

    // Trigger 5 errors (max attempts)
    for (let i = 0; i < 5; i++) {
      errorHandler(new Error('connection lost'));
      jest.advanceTimersByTime(30_000); // advance past max delay
    }

    const callCount = graphql.subscribe.mock.calls.length;

    // 6th error should NOT trigger reconnect
    errorHandler(new Error('connection lost'));
    jest.advanceTimersByTime(60_000);
    expect(graphql.subscribe).toHaveBeenCalledTimes(callCount);

    consoleSpy.mockRestore();
  });

  it('should clear pending reconnect timeout on unsubscribe', () => {
    let errorHandler!: (err: Error) => void;
    const mockSubscribe = jest.fn().mockImplementation((handlers: any) => {
      errorHandler = handlers.error;
      return { unsubscribe: jest.fn() };
    });
    graphql.subscribe.mockReturnValue({ subscribe: mockSubscribe } as any);

    service.subscribeToNotifications(jest.fn());
    errorHandler(new Error('connection lost'));

    // Unsubscribe before the timer fires
    service.unsubscribeFromNotifications();
    jest.advanceTimersByTime(30_000);

    // Should still be just 1 subscribe call (no reconnect happened)
    expect(graphql.subscribe).toHaveBeenCalledTimes(1);
  });
});
