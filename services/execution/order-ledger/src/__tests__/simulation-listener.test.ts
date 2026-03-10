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
    protected async queryAll(input: unknown) {
      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const result = await this.docClient.send(new QueryCommand(input));
      return result.Items ?? [];
    }
  },
  getUUID: jest.fn().mockReturnValue('sim-uuid'),
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

jest.mock('@nestfolio/command-core', () => ({}));

import { SQSEvent } from 'aws-lambda';
import { createHandler } from '../handlers/simulation-listener';
import { LedgerRepository } from '../repositories/ledger.repository';
import { ShadowFillService } from '../services/shadow-fill.service';
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

describe('order-ledger simulation-listener handler', () => {
  const ORIGINAL_ENV = process.env;

  const mockMetrics = {
    addMetric: jest.fn(),
    addDimension: jest.fn(),
    publishStoredMetrics: jest.fn(),
  };

  const repository = new LedgerRepository('test-table');
  const shadowFill = new ShadowFillService();

  let handler: (event: SQSEvent) => Promise<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ Items: [], Attributes: { lastSequence: 1 } });
    process.env = { ...ORIGINAL_ENV, TABLE_NAME: 'test-table' };

    handler = createHandler({
      repository,
      idempotencyGuard: new IdempotencyGuard({} as any, 'test-table'),
      bus: { publish: jest.fn().mockResolvedValue(undefined) } as any,
      metrics: mockMetrics as any,
      shadowFill,
    });
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should process DECISION_PACKET_CREATED and write simulated LedgerEntries', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-1',
        body: {
          detail: {
            id: 'evt-1',
            type: 'DECISION_PACKET_CREATED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              tenantId: 't1',
              decisionPacketId: 'dp-1',
              proposedTrades: [
                { symbol: 'VTI', side: 'BUY', quantity: 10 },
                { symbol: 'SPY', side: 'BUY', quantity: 5 },
              ],
            },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockMetrics.addMetric).toHaveBeenCalledWith('SimulationProcessed', 'Count', 1);
    // 2 trades → 2 nextSequence calls + 2 putLedgerEntry calls = 4 DDB operations
    // Plus the idempotency check. Each putLedgerEntry calls 1 Put, each nextSequence calls 1 Update
    const putCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Put');
    expect(putCalls.length).toBe(2);
  });

  it('should skip non-DECISION_PACKET_CREATED events', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-2',
        body: {
          detail: {
            id: 'evt-2',
            type: 'ORDER_FILLED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: { tenantId: 't1' },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockMetrics.addMetric).not.toHaveBeenCalledWith('SimulationProcessed', 'Count', 1);
  });

  it('should skip duplicate events via idempotency guard', async () => {
    const guardInstance = (IdempotencyGuard as unknown as jest.Mock).mock.results[0]?.value;
    if (guardInstance) {
      guardInstance.ensureOnce.mockResolvedValue(false);
    }

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-dup',
        body: {
          detail: {
            id: 'evt-dup',
            type: 'DECISION_PACKET_CREATED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              tenantId: 't1',
              decisionPacketId: 'dp-dup',
              proposedTrades: [{ symbol: 'VTI', side: 'BUY', quantity: 10 }],
            },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
    // No puts should happen for duplicate
    const putCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Put');
    expect(putCalls.length).toBe(0);
  });

  it('should skip decision packets with no proposed trades', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-empty',
        body: {
          detail: {
            id: 'evt-empty',
            type: 'DECISION_PACKET_CREATED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              tenantId: 't1',
              decisionPacketId: 'dp-empty',
              proposedTrades: [],
            },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockMetrics.addMetric).not.toHaveBeenCalledWith('SimulationProcessed', 'Count', 1);
  });

  it('should report batch item failures for processing errors', async () => {
    const { parseRecord } = require('@nestfolio/lambda-utils');
    (parseRecord as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Parse error');
    });

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-fail',
        body: { detail: { id: 'evt-fail', type: 'DECISION_PACKET_CREATED', subject: {} } },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-fail');
  });

  it('should use shadow fill prices for simulated entries', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-price',
        body: {
          detail: {
            id: 'evt-price',
            type: 'DECISION_PACKET_CREATED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              tenantId: 't1',
              decisionPacketId: 'dp-price',
              proposedTrades: [{ symbol: 'QQQ', side: 'BUY', quantity: 2 }],
            },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    await handler(sqsEvent);

    const putCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Put');
    expect(putCalls.length).toBe(1);
    const putItem = putCalls[0][0].input.Item;
    expect(putItem.payload.fillPrice).toBe(445.60);
    expect(putItem.streamType).toBe('simulated');
    expect(putItem.orderId).toBe('sim-dp-price-QQQ');
  });
});
