const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutItemCommand: jest.fn().mockImplementation((input) => ({ _type: 'PutItem', input })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: jest.fn().mockImplementation(() => ({ send: mockSend })),
    },
    PutCommand: jest.fn().mockImplementation((input) => ({ _type: 'Put', input })),
    GetCommand: jest.fn().mockImplementation((input) => ({ _type: 'Get', input })),
    QueryCommand: jest.fn().mockImplementation((input) => ({ _type: 'Query', input })),
    UpdateCommand: jest.fn().mockImplementation((input) => ({ _type: 'Update', input })),
    TransactWriteCommand: jest.fn().mockImplementation((input) => ({ _type: 'TransactWrite', input })),
  };
});

jest.mock('@nestfolio/platform-core', () => ({
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
    protected async transactWrite(input: unknown) {
      const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(new TransactWriteCommand(input));
    }
    protected buildTransactUpdate(pk: string, sk: string, attrs: Record<string, unknown>) {
      const entries = Object.entries(attrs);
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};
      const sets: string[] = [];
      entries.forEach(([k, v], i) => { names[`#a${i}`] = k; values[`:v${i}`] = v; sets.push(`#a${i} = :v${i}`); });
      return { Update: { TableName: this.tableName, Key: { pk, sk }, UpdateExpression: `SET ${sets.join(', ')}`, ExpressionAttributeNames: names, ExpressionAttributeValues: values } };
    }
  },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
  parseRecord: jest.fn((record) => {
    const body = JSON.parse(record.body);
    const event = body.detail ?? body;
    return { event, payload: event.subject ?? {}, record };
  }),
  IdempotencyGuard: jest.fn().mockImplementation(() => ({
    ensureOnce: jest.fn().mockResolvedValue(true),
  })),
  extractTenantId: jest.fn((event: Record<string, unknown>) => {
    const context = event.context as Record<string, unknown> | undefined;
    const subject = event.subject as Record<string, unknown> | undefined;
    const id = context?.tenantId ?? subject?.tenantId;
    if (!id || typeof id !== 'string') throw new Error('Missing tenantId');
    return id;
  }),
  createServiceMetrics: jest.fn().mockReturnValue({
    addMetric: jest.fn(),
    addDimension: jest.fn(),
    publishStoredMetrics: jest.fn(),
  }),
  isRetryable: jest.fn().mockReturnValue(true),
  traceEvent: jest.fn(),
  MetricUnit: { Count: 'Count' },
  applyMiddleware: jest.fn((handler) => handler),
  withLambdaContext: jest.fn(() => (next: unknown) => next),
  withTiming: jest.fn(() => (next: unknown) => next),
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
  publishErrorEvent: jest.fn().mockResolvedValue(undefined),
  EventBridgeBus: jest.fn(),
}));

jest.mock('@nestfolio/domain-core', () => ({}));

import { SQSEvent } from 'aws-lambda';
import { createHandler } from '../src/handlers/event-listener';
import { PortfolioRepository } from '../src/repositories/portfolio.repository';
import { OrderFilledPipe } from '../src/pipes/order-filled.pipe';
import { SnapshotImportedPipe } from '../src/pipes/snapshot-imported.pipe';
import { IdempotencyGuard } from '@nestfolio/lambda-utils';

function buildSqsEvent(records: Array<{ messageId: string; body: Record<string, unknown> }>): SQSEvent {
  return {
    Records: records.map((r) => ({
      messageId: r.messageId,
      body: JSON.stringify(r.body),
      receiptHandle: 'handle',
      attributes: {} as any,
      messageAttributes: {},
      md5OfBody: '',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test',
      awsRegion: 'us-east-1',
    })),
  };
}

describe('event-listener handler', () => {
  const ORIGINAL_ENV = process.env;

  const mockMetrics = {
    addMetric: jest.fn(),
    addDimension: jest.fn(),
    publishStoredMetrics: jest.fn(),
  };

  const repository = new PortfolioRepository('test-table');
  const idempotencyGuard = new IdempotencyGuard({} as any, 'test-table');

  const mockOrderFilledPipe = { process: jest.fn().mockResolvedValue(undefined) };
  const mockSnapshotImportedPipe = { process: jest.fn().mockResolvedValue(undefined) };

  let handler: (event: SQSEvent) => Promise<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    process.env = { ...ORIGINAL_ENV, TABLE_NAME: 'test-table' };

    handler = createHandler({
      repository,
      idempotencyGuard,
      orderFilledPipe: mockOrderFilledPipe as unknown as OrderFilledPipe,
      snapshotImportedPipe: mockSnapshotImportedPipe as unknown as SnapshotImportedPipe,
      bus: { publish: jest.fn().mockResolvedValue(undefined) } as any,
      metrics: mockMetrics as any,
    });
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should process ORDER_FILLED event', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-1',
        body: {
          detail: {
            id: 'evt-1',
            type: 'ORDER_FILLED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              tenantId: 't1',
              portfolioId: 'p1',
              symbol: 'AAPL',
              side: 'BUY',
              filledQuantity: 100,
              averageFillPrice: 150,
            },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockOrderFilledPipe.process).toHaveBeenCalled();
  });

  it('should process PORTFOLIO_SNAPSHOT_IMPORTED event', async () => {
    // getOrCreatePortfolio -> getCommand returns existing
    mockSend.mockResolvedValueOnce({ Item: { pk: 'Portfolio#t1#p1', sk: 'Portfolio' } });

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-2',
        body: {
          detail: {
            id: 'evt-2',
            type: 'PORTFOLIO_SNAPSHOT_IMPORTED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              tenantId: 't1',
              portfolioId: 'p1',
              positions: [
                { symbol: 'AAPL', quantity: 100, averageCostBasis: 150, currentPrice: 175 },
              ],
              cashBalance: 10000,
              currency: 'USD',
            },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockSnapshotImportedPipe.process).toHaveBeenCalled();
  });

  it('should pass expectedVersion from existing position when handling CORPORATE_ACTION_APPLIED', async () => {
    // Reset mockSend completely to clear any queued once-values from prior tests
    mockSend.mockReset();

    // getPosition returns existing position with version
    const existingPosition = {
      pk: 'Portfolio#t1#t1',
      sk: 'Position#AAPL',
      quantity: 100,
      avgCostBasis: 150,
      currentPrice: 175,
      version: 3,
    };
    mockSend.mockResolvedValueOnce({ Item: existingPosition });
    // upsertPosition -> transactWrite (default for remaining calls)
    mockSend.mockResolvedValue({});

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-corp-action',
        body: {
          detail: {
            id: 'evt-corp',
            type: 'CORPORATE_ACTION_APPLIED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              tenantId: 't1',
              portfolioId: 't1',
              actionType: 'SPLIT',
              symbol: 'AAPL',
              ratio: 2,
            },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);

    // Verify mockSend was called (getPosition + transactWrite)
    expect(mockSend).toHaveBeenCalled();

    // Find the transactWrite call (the one with TransactItems)
    const transactCall = mockSend.mock.calls.find(
      (call) => call[0]?.input?.TransactItems,
    );
    expect(transactCall).toBeDefined();

    const transactItems = transactCall![0].input.TransactItems;
    expect(transactItems).toHaveLength(2);

    // Position Put should include ConditionExpression for optimistic locking
    const positionPut = transactItems[0].Put;
    expect(positionPut.Item.instrument).toBe('AAPL');
    expect(positionPut.Item.quantity).toBe(200); // 100 * 2
    expect(positionPut.Item.version).toBe(4); // expectedVersion (3) + 1
    expect(positionPut.ConditionExpression).toBe('#v = :expectedVersion');
    expect(positionPut.ExpressionAttributeNames).toEqual({ '#v': 'version' });
    expect(positionPut.ExpressionAttributeValues).toEqual({ ':expectedVersion': 3 });
  });

  it('should report failure for malformed event body (invalid JSON)', async () => {
    const sqsEvent: SQSEvent = {
      Records: [{
        messageId: 'msg-malformed',
        body: '{{invalid',
        receiptHandle: 'handle',
        attributes: {} as any,
        messageAttributes: {},
        md5OfBody: '',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:test',
        awsRegion: 'us-east-1',
      }],
    };

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-malformed');
  });

  it('should skip unknown event types gracefully', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-3',
        body: {
          detail: {
            id: 'evt-3',
            type: 'UNKNOWN_EVENT',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {},
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should report batch item failures for processing errors', async () => {
    const { parseRecord } = require('@nestfolio/lambda-utils');
    (parseRecord as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Parse error');
    });

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-fail',
        body: { detail: { id: 'evt-fail', type: 'ORDER_FILLED', subject: {} } },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-fail');
  });

  it('should NOT add to batchItemFailures when error is not retryable', async () => {
    const { parseRecord, isRetryable } = require('@nestfolio/lambda-utils');
    (parseRecord as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Non-retryable error');
    });
    (isRetryable as jest.Mock).mockReturnValueOnce(false);

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-non-retryable',
        body: { detail: { id: 'evt-nr', type: 'ORDER_FILLED', subject: {} } },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(isRetryable).toHaveBeenCalled();
  });
});
