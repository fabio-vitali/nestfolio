import { DynamoDBStreamEvent } from 'aws-lambda';
import { NotRetryableError } from '@nestfolio/platform-core';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({ send: mockSend })),
  PutEventsCommand: jest.fn((input) => ({ input })),
}));

import { handler } from './event-publisher';

function makeStreamEvent(records: Array<{
  eventID?: string;
  newImage?: Record<string, { S?: string; N?: string }>;
}>): DynamoDBStreamEvent {
  return {
    Records: records.map((r) => ({
      eventID: r.eventID ?? 'evt-1',
      eventName: 'INSERT' as const,
      dynamodb: r.newImage
        ? { NewImage: r.newImage }
        : {},
    })),
  };
}

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

  it('publishes a single record to EventBridge', async () => {
    await handler(makeStreamEvent([{
      newImage: {
        __typename: { S: 'OrderFilled' },
        pk: { S: 'TENANT#t1' },
      },
    }]));

    expect(mockSend).toHaveBeenCalledTimes(1);
    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.input.Entries).toHaveLength(1);
    expect(cmd.input.Entries[0].EventBusName).toBe('test-bus');
    expect(cmd.input.Entries[0].Source).toBe('test-bus@test-svc');
    expect(cmd.input.Entries[0].DetailType).toBe('OrderFilled');
  });

  it('uses "Unknown" as DetailType when __typename is missing', async () => {
    await handler(makeStreamEvent([{
      newImage: { pk: { S: 'TENANT#t1' } },
    }]));

    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.input.Entries[0].DetailType).toBe('Unknown');
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

  it('throws on partial failure from EventBridge', async () => {
    mockSend.mockResolvedValue({
      FailedEntryCount: 1,
      Entries: [{ ErrorCode: 'ThrottlingException', ErrorMessage: 'Rate exceeded' }],
    });

    await expect(
      handler(makeStreamEvent([{
        newImage: { __typename: { S: 'Fail' } },
      }])),
    ).rejects.toThrow('Failed to publish 1 event(s) to EventBridge');
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
