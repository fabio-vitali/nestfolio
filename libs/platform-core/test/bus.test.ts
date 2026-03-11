import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { EventBridgeBus, type BusEvent } from '../src/bus';
import { NotRetryableError } from '../src/errors';

jest.mock('../src/logger', () => ({
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('@aws-sdk/client-eventbridge', () => {
  const actual = jest.requireActual('@aws-sdk/client-eventbridge');
  return {
    ...actual,
    EventBridgeClient: jest.fn(),
    PutEventsCommand: jest.fn().mockImplementation((input) => ({ input })),
  };
});

describe('EventBridgeBus', () => {
  let bus: EventBridgeBus;
  let mockSend: jest.Mock;

  beforeEach(() => {
    mockSend = jest.fn().mockResolvedValue({ FailedEntryCount: 0, Entries: [{}] });
    (EventBridgeClient as jest.Mock).mockImplementation(() => ({
      send: mockSend,
    }));
    bus = new EventBridgeBus('test-bus', 'test-service');
  });

  it('should publish event to EventBridge with correct parameters', async () => {
    const event: BusEvent = {
      id: 'evt-1',
      type: 'ORDER_CREATED',
      timestamp: '2026-01-01T00:00:00.000Z',
      subject: { orderId: 'o-1' },
      context: { tenantId: 't-1' },
    };

    await bus.publish(event);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(PutEventsCommand).toHaveBeenCalledWith({
      Entries: [
        {
          EventBusName: 'test-bus',
          Source: 'test-bus@test-service',
          DetailType: 'ORDER_CREATED',
          Detail: JSON.stringify(event),
        },
      ],
    });
  });

  it('should throw NotRetryableError for non-retryable error codes', async () => {
    mockSend.mockResolvedValue({
      FailedEntryCount: 1,
      Entries: [{ ErrorCode: 'InternalError', ErrorMessage: 'Service unavailable' }],
    });

    const event: BusEvent = {
      id: 'evt-2',
      type: 'ORDER_FAILED',
      timestamp: '2026-01-01T00:00:00.000Z',
      subject: {},
      context: {},
    };

    await expect(bus.publish(event)).rejects.toThrow(NotRetryableError);
    await expect(bus.publish(event)).rejects.toThrow('EventBridge publish failed: Service unavailable');
  });

  it('should throw retryable Error for ThrottlingException', async () => {
    mockSend.mockResolvedValue({
      FailedEntryCount: 1,
      Entries: [{ ErrorCode: 'ThrottlingException', ErrorMessage: 'Rate exceeded' }],
    });

    const event: BusEvent = {
      id: 'evt-3',
      type: 'ORDER_THROTTLED',
      timestamp: '2026-01-01T00:00:00.000Z',
      subject: {},
      context: {},
    };

    await expect(bus.publish(event)).rejects.toThrow(Error);
    await expect(bus.publish(event)).rejects.not.toThrow(NotRetryableError);
    await expect(bus.publish(event)).rejects.toThrow('retryable');
  });

  it('should throw retryable Error for InternalException', async () => {
    mockSend.mockResolvedValue({
      FailedEntryCount: 1,
      Entries: [{ ErrorCode: 'InternalException', ErrorMessage: 'Internal failure' }],
    });

    const event: BusEvent = {
      id: 'evt-4',
      type: 'ORDER_INTERNAL',
      timestamp: '2026-01-01T00:00:00.000Z',
      subject: {},
      context: {},
    };

    await expect(bus.publish(event)).rejects.toThrow(Error);
    await expect(bus.publish(event)).rejects.not.toThrow(NotRetryableError);
    await expect(bus.publish(event)).rejects.toThrow('retryable');
  });

  it('should log all failed entries', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    mockSend.mockResolvedValue({
      FailedEntryCount: 1,
      Entries: [{ ErrorCode: 'SomeError', ErrorMessage: 'Something failed' }],
    });

    const event: BusEvent = {
      id: 'evt-5',
      type: 'ORDER_LOG_TEST',
      timestamp: '2026-01-01T00:00:00.000Z',
      subject: {},
      context: {},
    };

    await expect(bus.publish(event)).rejects.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(
      'EventBridge publish failed entry',
      expect.objectContaining({
        errorCode: 'SomeError',
        errorMessage: 'Something failed',
        eventType: 'ORDER_LOG_TEST',
        eventId: 'evt-5',
      }),
    );

    consoleSpy.mockRestore();
  });
});
