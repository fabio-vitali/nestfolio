import { DynamoDBStreamEvent } from 'aws-lambda';
import { NotRetryableError } from '@nestfolio/platform-core';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({ send: mockSend })),
  PutEventsCommand: jest.fn((input) => ({ input })),
}));

import { handler, toScreamingSnake, toDetailType } from '../src/event-publisher';

function makeStreamEvent(records: Array<{
  eventID?: string;
  eventName?: 'INSERT' | 'MODIFY' | 'REMOVE';
  newImage?: Record<string, { S?: string; N?: string }>;
}>): DynamoDBStreamEvent {
  return {
    Records: records.map((r) => ({
      eventID: r.eventID ?? 'evt-1',
      eventName: r.eventName ?? ('INSERT' as const),
      dynamodb: r.newImage
        ? { NewImage: r.newImage }
        : {},
    })),
  };
}

describe('toScreamingSnake', () => {
  it('converts PascalCase to SCREAMING_SNAKE_CASE', () => {
    expect(toScreamingSnake('DecisionPacket')).toBe('DECISION_PACKET');
    expect(toScreamingSnake('RiskProfile')).toBe('RISK_PROFILE');
    expect(toScreamingSnake('OrderFilled')).toBe('ORDER_FILLED');
    expect(toScreamingSnake('Goal')).toBe('GOAL');
    expect(toScreamingSnake('Order')).toBe('ORDER');
    expect(toScreamingSnake('Notification')).toBe('NOTIFICATION');
  });
});

describe('toDetailType', () => {
  it('maps INSERT to _CREATED', () => {
    expect(toDetailType('Goal', 'INSERT')).toBe('GOAL_CREATED');
    expect(toDetailType('DecisionPacket', 'INSERT')).toBe('DECISION_PACKET_CREATED');
  });

  it('maps MODIFY to _UPDATED', () => {
    expect(toDetailType('RiskProfile', 'MODIFY')).toBe('RISK_PROFILE_UPDATED');
    expect(toDetailType('Order', 'MODIFY')).toBe('ORDER_UPDATED');
  });

  it('maps REMOVE to _DELETED', () => {
    expect(toDetailType('Goal', 'REMOVE')).toBe('GOAL_DELETED');
  });

  it('maps unknown operations to _CHANGED', () => {
    expect(toDetailType('Order', 'UNKNOWN')).toBe('ORDER_CHANGED');
  });
});

describe('toDetailType with customEventTypeMap', () => {
  const ENV_BACKUP = process.env;

  afterEach(() => {
    process.env = ENV_BACKUP;
  });

  it('uses custom mapping when key matches', () => {
    process.env.CUSTOM_EVENT_TYPE_MAP = JSON.stringify({
      'Deposit:INSERT': 'DEPOSIT_INITIATED',
      'Withdrawal:INSERT': 'WITHDRAWAL_REQUESTED',
    });
    expect(toDetailType('Deposit', 'INSERT')).toBe('DEPOSIT_INITIATED');
  });

  it('uses second custom mapping when key matches', () => {
    process.env.CUSTOM_EVENT_TYPE_MAP = JSON.stringify({
      'Deposit:INSERT': 'DEPOSIT_INITIATED',
      'Withdrawal:INSERT': 'WITHDRAWAL_REQUESTED',
    });
    expect(toDetailType('Withdrawal', 'INSERT')).toBe('WITHDRAWAL_REQUESTED');
  });

  it('falls back to convention when no custom mapping', () => {
    process.env.CUSTOM_EVENT_TYPE_MAP = '{}';
    expect(toDetailType('Goal', 'INSERT')).toBe('GOAL_CREATED');
  });

  it('falls back to convention when env var is not set', () => {
    delete process.env.CUSTOM_EVENT_TYPE_MAP;
    expect(toDetailType('RiskProfile', 'MODIFY')).toBe('RISK_PROFILE_UPDATED');
  });
});

describe('event-publisher handler', () => {
  const ENV_BACKUP = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ENV_BACKUP, BUS_NAME: 'test-bus', SERVICE_NAME: 'test-svc' };
    mockSend.mockResolvedValue({ FailedEntryCount: 0, Entries: [] });
  });

  afterEach(() => {
    process.env = ENV_BACKUP;
  });

  it('throws NotRetryableError when BUS_NAME is missing', async () => {
    delete process.env.BUS_NAME;
    await expect(handler(makeStreamEvent([]))).rejects.toThrow(NotRetryableError);
  });

  it('throws NotRetryableError when SERVICE_NAME is missing', async () => {
    delete process.env.SERVICE_NAME;
    await expect(handler(makeStreamEvent([]))).rejects.toThrow(NotRetryableError);
  });

  it('skips records with no NewImage', async () => {
    await handler(makeStreamEvent([{ newImage: undefined }]));
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('derives DetailType from eventName + __typename', async () => {
    await handler(makeStreamEvent([{
      eventName: 'INSERT',
      newImage: {
        __typename: { S: 'OrderFilled' },
        pk: { S: 'TENANT#t1' },
        tenantId: { S: 't1' },
      },
    }]));

    expect(mockSend).toHaveBeenCalledTimes(1);
    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.input.Entries).toHaveLength(1);
    expect(cmd.input.Entries[0].EventBusName).toBe('test-bus');
    expect(cmd.input.Entries[0].Source).toBe('test-bus@test-svc');
    expect(cmd.input.Entries[0].DetailType).toBe('ORDER_FILLED_CREATED');
  });

  it('uses MODIFY suffix for modify events', async () => {
    await handler(makeStreamEvent([{
      eventName: 'MODIFY',
      newImage: {
        __typename: { S: 'Goal' },
        tenantId: { S: 't1' },
      },
    }]));

    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.input.Entries[0].DetailType).toBe('GOAL_UPDATED');
  });

  it('wraps item in BusEvent envelope', async () => {
    await handler(makeStreamEvent([{
      eventName: 'INSERT',
      newImage: {
        __typename: { S: 'Goal' },
        tenantId: { S: 't1' },
        pk: { S: 'TENANT#t1' },
      },
    }]));

    const cmd = mockSend.mock.calls[0][0];
    const detail = JSON.parse(cmd.input.Entries[0].Detail);
    expect(detail).toMatchObject({
      type: 'GOAL_CREATED',
      context: { tenantId: 't1' },
    });
    expect(detail.subject).toBeDefined();
    expect(detail.subject.__typename).toBe('Goal');
    expect(detail.id).toBeDefined();
    expect(detail.timestamp).toBeDefined();
  });

  it('uses UNKNOWN_CHANGED when __typename is missing', async () => {
    await handler(makeStreamEvent([{
      newImage: { pk: { S: 'TENANT#t1' } },
    }]));

    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.input.Entries[0].DetailType).toBe('UNKNOWN_CREATED');
  });

  it('batches records in groups of 10', async () => {
    const records = Array.from({ length: 12 }, (_, i) => ({
      eventID: `evt-${i}`,
      newImage: { __typename: { S: 'Item' }, id: { S: `${i}` } },
    }));

    await handler(makeStreamEvent(records));
    expect(mockSend).toHaveBeenCalledTimes(2);

    const batch1 = mockSend.mock.calls[0][0];
    const batch2 = mockSend.mock.calls[1][0];
    expect(batch1.input.Entries).toHaveLength(10);
    expect(batch2.input.Entries).toHaveLength(2);
  });

  it('retries retryable errors (ThrottlingException) and succeeds', async () => {
    // First call: throttling failure
    mockSend.mockResolvedValueOnce({
      FailedEntryCount: 1,
      Entries: [{ ErrorCode: 'ThrottlingException', ErrorMessage: 'Rate exceeded' }],
    });
    // Second call (retry): success
    mockSend.mockResolvedValueOnce({ FailedEntryCount: 0, Entries: [{}] });

    await handler(makeStreamEvent([{
      newImage: { __typename: { S: 'Retry' } },
    }]));

    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('throws NotRetryableError for non-retryable error codes', async () => {
    mockSend.mockResolvedValue({
      FailedEntryCount: 1,
      Entries: [{ ErrorCode: 'ValidationException', ErrorMessage: 'Invalid input' }],
    });

    await expect(
      handler(makeStreamEvent([{
        newImage: { __typename: { S: 'Fail' } },
      }])),
    ).rejects.toThrow(NotRetryableError);
  });

  it('throws after retries exhausted for retryable errors', async () => {
    // All 3 attempts fail with throttling
    mockSend.mockResolvedValue({
      FailedEntryCount: 1,
      Entries: [{ ErrorCode: 'ThrottlingException', ErrorMessage: 'Rate exceeded' }],
    });

    await expect(
      handler(makeStreamEvent([{
        newImage: { __typename: { S: 'Fail' } },
      }])),
    ).rejects.toThrow('Failed to publish 1 event(s) to EventBridge after 2 retries');

    // 1 original + 2 retries = 3 calls
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('retries only failed entries from partial batch failure', async () => {
    // First call: 1 of 2 entries fails
    mockSend.mockResolvedValueOnce({
      FailedEntryCount: 1,
      Entries: [
        {},
        { ErrorCode: 'InternalException', ErrorMessage: 'Internal error' },
      ],
    });
    // Second call (retry): success with the single failed entry
    mockSend.mockResolvedValueOnce({ FailedEntryCount: 0, Entries: [{}] });

    await handler(makeStreamEvent([
      { newImage: { __typename: { S: 'Success' } } },
      { newImage: { __typename: { S: 'RetryMe' } } },
    ]));

    expect(mockSend).toHaveBeenCalledTimes(2);
    // Second call should only have 1 entry (the failed one)
    const retryCmd = mockSend.mock.calls[1][0];
    expect(retryCmd.input.Entries).toHaveLength(1);
  });

  it('handles empty Records array', async () => {
    await handler({ Records: [] });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('handles mixed records (some with NewImage, some without)', async () => {
    await handler(makeStreamEvent([
      { newImage: undefined },
      { newImage: { __typename: { S: 'Valid' } } },
      { newImage: undefined },
    ]));

    expect(mockSend).toHaveBeenCalledTimes(1);
    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.input.Entries).toHaveLength(1);
  });
});
