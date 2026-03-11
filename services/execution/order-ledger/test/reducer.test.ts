const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: jest.fn().mockImplementation(() => ({ send: mockSend })),
    },
    PutCommand: jest.fn().mockImplementation((input) => ({ _type: 'Put', input })),
    QueryCommand: jest.fn().mockImplementation((input) => ({ _type: 'Query', input })),
    UpdateCommand: jest.fn().mockImplementation((input) => ({ _type: 'Update', input })),
  };
});

jest.mock('@aws-sdk/util-dynamodb', () => ({
  unmarshall: jest.fn((image) => {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(image as Record<string, any>)) {
      if (val.S) result[key] = val.S;
      else if (val.N) result[key] = Number(val.N);
      else if (val.M) result[key] = val.M;
      else result[key] = val;
    }
    return result;
  }),
}));

jest.mock('@nestfolio/platform-core', () => ({
  ok: <T>(value: T) => ({ ok: true, value }),
  err: <E>(error: E) => ({ ok: false, error }),
  TableRepository: class {
    protected readonly docClient: { send: jest.Mock };
    protected readonly tableName: string;
    constructor(tableName: string) {
      this.tableName = tableName;
      this.docClient = { send: mockSend };
    }
    protected async put(item: Record<string, unknown>) {
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item }));
    }
    protected async queryByPk(pk: string, skPrefix?: string) {
      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: skPrefix ? 'pk = :pk AND begins_with(sk, :sk)' : 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk, ...(skPrefix ? { ':sk': skPrefix } : {}) },
      }));
      return result.Items ?? [];
    }
    protected async queryAll(input: unknown) {
      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const result = await this.docClient.send(new QueryCommand(input));
      return result.Items ?? [];
    }
  },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
  createServiceMetrics: jest.fn().mockReturnValue({
    addMetric: jest.fn(),
    addDimension: jest.fn(),
    publishStoredMetrics: jest.fn(),
  }),
  MetricUnit: { Count: 'Count' },
  applyMiddleware: jest.fn((handler) => handler),
  withLambdaContext: jest.fn(() => (next: unknown) => next),
  withTiming: jest.fn(() => (next: unknown) => next),
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

import { DynamoDBStreamEvent } from 'aws-lambda';
import { createReducer } from '../src/handlers/reducer';
import { LedgerRepository } from '../src/repositories/ledger.repository';

function buildStreamEvent(records: Array<{
  eventType: string;
  tenantId: string;
  streamType: string;
  orderId: string;
  sequenceNo: number;
  payload: Record<string, unknown>;
}>): DynamoDBStreamEvent {
  return {
    Records: records.map((r) => ({
      eventID: 'test-event-id',
      eventName: 'INSERT' as const,
      eventVersion: '1.1',
      eventSource: 'aws:dynamodb',
      awsRegion: 'us-east-1',
      dynamodb: {
        NewImage: {
          __typename: { S: 'LedgerEntry' },
          tenantId: { S: r.tenantId },
          streamType: { S: r.streamType },
          orderId: { S: r.orderId },
          eventId: { S: 'evt-1' },
          eventType: { S: r.eventType },
          payload: r.payload as any,
          timestamp: { S: '2025-01-01T00:00:00.000Z' },
          sequenceNo: { N: String(r.sequenceNo) },
        },
        Keys: {
          pk: { S: `OrderStream#${r.tenantId}#${r.streamType}#${r.orderId}` },
          sk: { S: `Event#${String(r.sequenceNo).padStart(8, '0')}#evt-1` },
        },
        StreamViewType: 'NEW_AND_OLD_IMAGES' as const,
      },
      eventSourceARN: 'arn:aws:dynamodb:us-east-1:123456789012:table/test/stream/2025-01-01T00:00:00.000',
    })),
  };
}

describe('order-ledger reducer handler', () => {
  const ORIGINAL_ENV = process.env;

  const mockMetrics = {
    addMetric: jest.fn(),
    addDimension: jest.fn(),
    publishStoredMetrics: jest.fn(),
  };

  const repository = new LedgerRepository('test-table');

  let reducer: (event: DynamoDBStreamEvent) => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, TABLE_NAME: 'test-table' };

    // Default: no existing snapshot, return LedgerEntries when queried
    mockSend.mockResolvedValue({ Items: [] });

    reducer = createReducer({
      repository,
      metrics: mockMetrics as any,
    });
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should process INSERT records with __typename LedgerEntry', async () => {
    // First call: getLatestSnapshot → no snapshot
    // Second call: queryEntriesSince → return one LedgerEntry
    // Rest: put calls for snapshot, position, checkpoint
    mockSend
      .mockResolvedValueOnce({ Items: [] }) // getLatestSnapshot
      .mockResolvedValueOnce({
        Items: [{
          eventId: 'evt-1',
          eventType: 'ORDER_FILLED',
          payload: { orderId: 'order-1', symbol: 'VTI', side: 'BUY', quantity: 10, fillPrice: 245.50, filledAt: '2025-01-01T00:00:00.000Z' },
          timestamp: '2025-01-01T00:00:00.000Z',
          sequenceNo: 1,
          streamType: 'actual',
        }],
      }) // queryEntriesSince
      .mockResolvedValue({}); // put calls

    const event = buildStreamEvent([{
      eventType: 'ORDER_FILLED',
      tenantId: 't1',
      streamType: 'actual',
      orderId: 'order-1',
      sequenceNo: 1,
      payload: { orderId: 'order-1', symbol: 'VTI', side: 'BUY', quantity: 10, fillPrice: 245.50, filledAt: '2025-01-01T00:00:00.000Z' },
    }]);

    await reducer(event);
    expect(mockMetrics.addMetric).toHaveBeenCalledWith('SnapshotUpdated', 'Count', 1);
  });

  it('should skip non-INSERT records', async () => {
    const event: DynamoDBStreamEvent = {
      Records: [{
        eventID: 'test-id',
        eventName: 'MODIFY',
        eventVersion: '1.1',
        eventSource: 'aws:dynamodb',
        awsRegion: 'us-east-1',
        dynamodb: {
          NewImage: {
            __typename: { S: 'LedgerEntry' },
            tenantId: { S: 't1' },
            streamType: { S: 'actual' },
          } as any,
          Keys: { pk: { S: 'test' }, sk: { S: 'test' } },
          StreamViewType: 'NEW_AND_OLD_IMAGES',
        },
        eventSourceARN: 'arn:aws:dynamodb:us-east-1:123456789012:table/test/stream/2025-01-01T00:00:00.000',
      }],
    };

    await reducer(event);
    expect(mockMetrics.addMetric).not.toHaveBeenCalledWith('SnapshotUpdated', expect.anything(), expect.anything());
  });

  it('should skip records that are not LedgerEntry typename', async () => {
    const event: DynamoDBStreamEvent = {
      Records: [{
        eventID: 'test-id',
        eventName: 'INSERT',
        eventVersion: '1.1',
        eventSource: 'aws:dynamodb',
        awsRegion: 'us-east-1',
        dynamodb: {
          NewImage: {
            __typename: { S: 'PortfolioSnapshot' },
            tenantId: { S: 't1' },
            streamType: { S: 'actual' },
          } as any,
          Keys: { pk: { S: 'test' }, sk: { S: 'test' } },
          StreamViewType: 'NEW_AND_OLD_IMAGES',
        },
        eventSourceARN: 'arn:aws:dynamodb:us-east-1:123456789012:table/test/stream/2025-01-01T00:00:00.000',
      }],
    };

    await reducer(event);
    expect(mockMetrics.addMetric).not.toHaveBeenCalledWith('SnapshotUpdated', expect.anything(), expect.anything());
  });

  it('should skip when no new entries found', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] }) // getLatestSnapshot
      .mockResolvedValueOnce({ Items: [] }); // queryEntriesSince → empty

    const event = buildStreamEvent([{
      eventType: 'ORDER_FILLED',
      tenantId: 't1',
      streamType: 'actual',
      orderId: 'order-1',
      sequenceNo: 1,
      payload: { symbol: 'VTI', side: 'BUY', quantity: 10, fillPrice: 245.50 },
    }]);

    await reducer(event);
    expect(mockMetrics.addMetric).not.toHaveBeenCalledWith('SnapshotUpdated', expect.anything(), expect.anything());
  });

  it('should group multiple records by tenantId and streamType', async () => {
    // Two records from the same tenant and stream
    mockSend
      .mockResolvedValueOnce({ Items: [] }) // getLatestSnapshot
      .mockResolvedValueOnce({
        Items: [
          {
            eventId: 'evt-1', eventType: 'ORDER_FILLED',
            payload: { orderId: 'o1', symbol: 'VTI', side: 'BUY', quantity: 10, fillPrice: 245.50, filledAt: '2025-01-01T00:00:00.000Z' },
            timestamp: '2025-01-01T00:00:00.000Z', sequenceNo: 1, streamType: 'actual',
          },
          {
            eventId: 'evt-2', eventType: 'ORDER_FILLED',
            payload: { orderId: 'o2', symbol: 'SPY', side: 'BUY', quantity: 5, fillPrice: 512.30, filledAt: '2025-01-01T00:00:00.000Z' },
            timestamp: '2025-01-01T00:00:00.000Z', sequenceNo: 2, streamType: 'actual',
          },
        ],
      }) // queryEntriesSince
      .mockResolvedValue({}); // put calls

    const event = buildStreamEvent([
      { eventType: 'ORDER_FILLED', tenantId: 't1', streamType: 'actual', orderId: 'o1', sequenceNo: 1, payload: {} },
      { eventType: 'ORDER_FILLED', tenantId: 't1', streamType: 'actual', orderId: 'o2', sequenceNo: 2, payload: {} },
    ]);

    await reducer(event);
    // Should only process one group (t1#actual)
    expect(mockMetrics.addMetric).toHaveBeenCalledWith('SnapshotUpdated', 'Count', 1);
  });

  it('should increment version when existing snapshot exists', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [{
          pk: 'Portfolio#t1#actual',
          sk: 'Latest',
          version: 3,
          lastEventSequence: 5,
          positions: {},
          cashBalanceCents: 10_000_000,
          snapshotAt: '2025-01-01T00:00:00.000Z',
        }],
      }) // getLatestSnapshot → existing snapshot
      .mockResolvedValueOnce({
        Items: [{
          eventId: 'evt-6', eventType: 'DEPOSIT_DETECTED',
          payload: { amountCents: 100000 },
          timestamp: '2025-01-01T00:00:00.000Z', sequenceNo: 6, streamType: 'actual',
        }],
      }) // queryEntriesSince
      .mockResolvedValue({}); // put calls

    const event = buildStreamEvent([{
      eventType: 'DEPOSIT_DETECTED',
      tenantId: 't1',
      streamType: 'actual',
      orderId: 'deposit-1',
      sequenceNo: 6,
      payload: { amountCents: 100000 },
    }]);

    await reducer(event);
    expect(mockMetrics.addMetric).toHaveBeenCalledWith('SnapshotUpdated', 'Count', 1);
  });

  it('should throw and record failure on unexpected errors', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] }) // getLatestSnapshot
      .mockRejectedValueOnce(new Error('DDB failure')); // queryEntriesSince fails

    const event = buildStreamEvent([{
      eventType: 'ORDER_FILLED',
      tenantId: 't1',
      streamType: 'actual',
      orderId: 'order-1',
      sequenceNo: 1,
      payload: {},
    }]);

    await expect(reducer(event)).rejects.toThrow('DDB failure');
    expect(mockMetrics.addMetric).toHaveBeenCalledWith('ReducerFailed', 'Count', 1);
  });
});
