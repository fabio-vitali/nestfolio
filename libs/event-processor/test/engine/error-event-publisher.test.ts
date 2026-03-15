import { ErrorEventPublisher } from '../../src/engine/error-event-publisher';

// Mock EventBridge client
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutEventsCommand: jest.fn().mockImplementation((input) => input),
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
  getUUID: jest.fn(() => 'uuid-123'),
  getTime: jest.fn(() => '2026-01-01T00:00:00Z'),
}));

describe('ErrorEventPublisher', () => {
  let publisher: ErrorEventPublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ FailedEntryCount: 0 });
    publisher = new ErrorEventPublisher('test-bus', 'test-service');
  });

  it('publishes non-retryable errors with causedBy', async () => {
    await publisher.publishErrors(
      [{ error: new Error('bad data'), causedBy: { eventType: 'ORDER_FILLED' } }],
      'TEST_SERVICE_FAILED',
    );
    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = mockSend.mock.calls[0][0];
    const detail = JSON.parse(call.Entries[0].Detail);
    expect(detail.subject.causedBy).toEqual({ eventType: 'ORDER_FILLED' });
    expect(detail.subject.error).toBe('bad data');
  });

  it('includes groupKey when provided', async () => {
    await publisher.publishErrors(
      [{ error: new Error('fail'), causedBy: {}, groupKey: 't1#actual' }],
      'TEST_STREAM_FAILED',
    );
    const detail = JSON.parse(mockSend.mock.calls[0][0].Entries[0].Detail);
    expect(detail.subject.groupKey).toBe('t1#actual');
  });

  it('swallows publish failures (fire-and-forget)', async () => {
    mockSend.mockRejectedValue(new Error('network error'));
    // Should NOT throw
    await expect(
      publisher.publishErrors(
        [{ error: new Error('original'), causedBy: {} }],
        'TEST_FAILED',
      ),
    ).resolves.toBeUndefined();
  });

  it('continues publishing remaining errors if one fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('fail-1')).mockResolvedValueOnce({ FailedEntryCount: 0 });
    await publisher.publishErrors(
      [
        { error: new Error('err-1'), causedBy: { a: 1 } },
        { error: new Error('err-2'), causedBy: { b: 2 } },
      ],
      'TEST_FAILED',
    );
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('does nothing for empty errors array', async () => {
    await publisher.publishErrors([], 'TEST_FAILED');
    expect(mockSend).not.toHaveBeenCalled();
  });
});
