import { replayAndReduce, type ReplayAndReduceConfig } from '../../src/pipelines/replay-and-reduce';
import { fakeDdbStreamRecord } from '../../src/testing/fake-records';

jest.mock('../../src/internal', () => {
  const original = jest.requireActual('../../src/internal');
  return {
    ...original,
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
});

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockImplementation(() => ({ send: mockSend })),
  },
  GetCommand: jest.fn().mockImplementation((input) => ({ ...input, _cmd: 'Get' })),
  PutCommand: jest.fn().mockImplementation((input) => ({ ...input, _cmd: 'Put' })),
}));
jest.mock('../../src/engine/error-event-publisher', () => ({
  ErrorEventPublisher: jest.fn().mockImplementation(() => ({
    publishErrors: jest.fn().mockResolvedValue(undefined),
  })),
}));

interface TestState { total: number }

const mockQueryEvents = jest.fn();

const testConfig: ReplayAndReduceConfig<TestState> = {
  serviceName: 'test-service',
  filter: (r) => r.__typename === 'Event',
  groupBy: { key: (r) => `${r.tenantId}#stream` },
  reducer: (state, event) => ({ total: state.total + ((event.amount as number) ?? 0) }),
  initialState: { total: 0 },
  snapshot: {
    key: (gk) => {
      const [tenantId] = gk.split('#');
      return { pk: `T#${tenantId}`, sk: 'Snapshot#current' };
    },
  },
  queryEvents: mockQueryEvents,
  requestContext: (gk, records) => ({
    tenantId: gk.split('#')[0],
    userId: (records[0]?.userId as string) ?? 'system',
    region: 'us-east-1',
  }),
};

describe('replayAndReduce', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-table';
  });

  afterEach(() => {
    delete process.env.TABLE_NAME;
  });

  it('returns a handler function', () => {
    const handler = replayAndReduce(testConfig);
    expect(typeof handler).toBe('function');
  });

  it('loads snapshot, queries events, reduces, and saves', async () => {
    // GetCommand: no existing snapshot
    mockSend.mockResolvedValueOnce({ Item: undefined });
    // queryEvents: returns events
    mockQueryEvents.mockResolvedValueOnce([
      { eventType: 'ADD', amount: 100, sequenceNo: 1 },
      { eventType: 'ADD', amount: 200, sequenceNo: 2 },
    ]);
    // PutCommand: save snapshot (success)
    mockSend.mockResolvedValueOnce({});

    const handler = replayAndReduce(testConfig);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Event#1', __typename: 'Event', tenantId: 't1', userId: 'u1', sequenceNo: 1,
        }),
      ],
    });

    // Verify snapshot save
    const putCall = mockSend.mock.calls[1][0];
    expect(putCall.Item.total).toBe(300);
    expect(putCall.Item.version).toBe(1);
    expect(putCall.Item.lastEventSequence).toBe(2);
    expect(putCall.Item.tenantId).toBe('t1');
    expect(putCall.Item.__typename).toBe('AccountSnapshot');
  });

  it('applies delta on existing snapshot', async () => {
    // GetCommand: existing snapshot
    mockSend.mockResolvedValueOnce({
      Item: { total: 500, version: 3, lastEventSequence: 10 },
    });
    // queryEvents: new events since seq 10
    mockQueryEvents.mockResolvedValueOnce([
      { eventType: 'ADD', amount: 50, sequenceNo: 11 },
    ]);
    // PutCommand: save
    mockSend.mockResolvedValueOnce({});

    const handler = replayAndReduce(testConfig);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Event#11', __typename: 'Event', tenantId: 't1', userId: 'u1', sequenceNo: 11,
        }),
      ],
    });

    const putCall = mockSend.mock.calls[1][0];
    expect(putCall.Item.total).toBe(550);
    expect(putCall.Item.version).toBe(4);
  });

  it('skips when no new events from query', async () => {
    mockSend.mockResolvedValueOnce({ Item: { total: 500, version: 3, lastEventSequence: 10 } });
    mockQueryEvents.mockResolvedValueOnce([]);

    const handler = replayAndReduce(testConfig);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Event#10', __typename: 'Event', tenantId: 't1', userId: 'u1', sequenceNo: 10,
        }),
      ],
    });

    // Only 1 DDB call (GetCommand), no Put
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('retries on ConditionalCheckFailedException', async () => {
    mockSend.mockResolvedValueOnce({ Item: { total: 0, version: 1, lastEventSequence: 0 } });
    mockQueryEvents.mockResolvedValueOnce([{ amount: 100, sequenceNo: 1 }]);
    // PutCommand fails with conditional check
    const condError = new Error('ConditionalCheckFailedException');
    condError.name = 'ConditionalCheckFailedException';
    mockSend.mockRejectedValueOnce(condError);

    const handler = replayAndReduce(testConfig);
    // Should throw (retryable) so DDB Stream retries the batch
    await expect(handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Event#1', __typename: 'Event', tenantId: 't1', userId: 'u1', sequenceNo: 1,
        }),
      ],
    })).rejects.toThrow('EgestionBatchError');
  });

  it('filters non-matching records', async () => {
    const handler = replayAndReduce(testConfig);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Guard#1', __typename: 'Guard', tenantId: 't1', userId: 'u1',
        }),
      ],
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('uses saveSnapshot override when provided', async () => {
    const mockSaveSnapshot = jest.fn().mockResolvedValue(undefined);
    const configWithSave = { ...testConfig, saveSnapshot: mockSaveSnapshot };

    // GetCommand: no existing snapshot
    mockSend.mockResolvedValueOnce({ Item: undefined });
    // queryEvents: returns events
    mockQueryEvents.mockResolvedValueOnce([
      { amount: 42, sequenceNo: 1 },
    ]);

    const handler = replayAndReduce(configWithSave);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Event#1', __typename: 'Event', tenantId: 't1', userId: 'u1', sequenceNo: 1,
        }),
      ],
    });

    expect(mockSaveSnapshot).toHaveBeenCalledTimes(1);
    expect(mockSaveSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      snapshotKey: { pk: 'T#t1', sk: 'Snapshot#current' },
      state: { total: 42 },
      lastEventSequence: 1,
      version: 1,
      requestContext: { tenantId: 't1', userId: 'u1', region: 'us-east-1' },
    }));
    // Only 1 DDB send call (GetCommand) — no default PutCommand
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('saves daily checkpoint when configured', async () => {
    const configWithDaily = { ...testConfig, snapshot: { ...testConfig.snapshot, daily: true } };

    mockSend.mockResolvedValueOnce({ Item: undefined }); // Get snapshot
    mockQueryEvents.mockResolvedValueOnce([{ amount: 100, sequenceNo: 1 }]); // queryEvents
    mockSend.mockResolvedValueOnce({}); // Put snapshot
    mockSend.mockResolvedValueOnce({}); // Put daily checkpoint

    const handler = replayAndReduce(configWithDaily);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Event#1', __typename: 'Event', tenantId: 't1', userId: 'u1', sequenceNo: 1,
        }),
      ],
    });

    expect(mockSend).toHaveBeenCalledTimes(3);
    const dailyPut = mockSend.mock.calls[2][0];
    const today = new Date().toISOString().slice(0, 10);
    expect(dailyPut.Item.sk).toBe(`Snapshot#${today}`);
    expect(dailyPut.Item.__typename).toBe('AccountCheckpoint');
    expect(dailyPut.Item.tenantId).toBe('t1');
  });
});
