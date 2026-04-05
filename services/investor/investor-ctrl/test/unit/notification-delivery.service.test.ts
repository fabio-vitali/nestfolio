jest.mock('@nestfolio/event-processor', () => ({
  logger: { info: jest.fn(), error: jest.fn() },

  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),

}));
import { NotificationDeliveryService } from '../src/services/notification-delivery.service';

describe('NotificationDeliveryService', () => {
  let service: NotificationDeliveryService;

  beforeEach(() => {
    service = new NotificationDeliveryService();
  });

  it('should deliver push notification', async () => {
    const result = await service.deliverPush({ title: 'Test', body: 'Body' }, 'token');
    expect(result.delivered).toBe(true);
    expect(result.channel).toBe('PUSH');
    expect(result.timestamp).toBeTruthy();
  });

  it('should deliver email notification', async () => {
    const result = await service.deliverEmail({ title: 'Test', body: 'Body' }, 'test@example.com');
    expect(result.delivered).toBe(true);
    expect(result.channel).toBe('EMAIL');
    expect(result.timestamp).toBeTruthy();
  });

  it('should include timestamp as ISO string', async () => {
    const result = await service.deliverPush({ title: 'Test', body: 'Body' }, 'token');
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
  });
});
