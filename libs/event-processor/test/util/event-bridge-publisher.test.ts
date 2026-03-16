import { EventBridgePublisher } from '../../src/util/event-bridge-publisher';
import { NotRetryableError } from '../../src/internal';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutEventsCommand: jest.fn().mockImplementation((input) => input),
}));

describe('EventBridgePublisher', () => {
  let publisher: EventBridgePublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ FailedEntryCount: 0, Entries: [] });
    publisher = new EventBridgePublisher('test-bus', 'test-source');
  });

  it('publishes entries in batches of 10', async () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({
      EventBusName: 'test-bus',
      Source: 'test-source',
      DetailType: `TYPE_${i}`,
      Detail: JSON.stringify({ i }),
    }));
    await publisher.publish(entries);
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[0][0].Entries).toHaveLength(10);
    expect(mockSend.mock.calls[1][0].Entries).toHaveLength(5);
  });

  it('retries failed entries (retryable error codes)', async () => {
    mockSend
      .mockResolvedValueOnce({
        FailedEntryCount: 1,
        Entries: [
          { EventId: 'ok' },
          { ErrorCode: 'ThrottlingException', ErrorMessage: 'throttled' },
        ],
      })
      .mockResolvedValueOnce({ FailedEntryCount: 0, Entries: [{ EventId: 'ok2' }] });

    const entries = [
      { EventBusName: 'b', Source: 's', DetailType: 'T1', Detail: '{}' },
      { EventBusName: 'b', Source: 's', DetailType: 'T2', Detail: '{}' },
    ];
    await publisher.publish(entries);
    // First call: 2 entries. Second call: 1 retry entry.
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[1][0].Entries).toHaveLength(1);
  });

  it('throws NotRetryableError on non-retryable error codes', async () => {
    mockSend.mockResolvedValue({
      FailedEntryCount: 1,
      Entries: [{ ErrorCode: 'ValidationException', ErrorMessage: 'bad' }],
    });
    const entries = [{ EventBusName: 'b', Source: 's', DetailType: 'T1', Detail: '{}' }];
    await expect(publisher.publish(entries)).rejects.toThrow(NotRetryableError);
  });

  it('throws after exhausting retries', async () => {
    const failResponse = {
      FailedEntryCount: 1,
      Entries: [{ ErrorCode: 'ThrottlingException', ErrorMessage: 'throttled' }],
    };
    mockSend.mockResolvedValue(failResponse);
    const entries = [{ EventBusName: 'b', Source: 's', DetailType: 'T1', Detail: '{}' }];
    // 1 initial + 2 retries = 3 total
    await expect(publisher.publish(entries)).rejects.toThrow('after 2 retries');
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('handles empty entries array', async () => {
    await publisher.publish([]);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
