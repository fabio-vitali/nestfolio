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

const mockQuotePrices: Record<string, number> = {
  VTI: 250.50, VXUS: 58.75, BND: 72.30, VNQ: 85.40, GLD: 195.80,
  SPY: 520.15, QQQ: 445.60, IWM: 210.25, EFA: 78.90, EEM: 42.15,
  TLT: 92.50, AGG: 98.75, VIG: 178.30, SCHD: 82.45, VOO: 480.20,
  VGSH: 58.10, VCIT: 80.55, VWO: 43.20, IEMG: 52.80, XLF: 42.90,
};

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
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  StaticMarketDataProvider: jest.fn().mockImplementation(() => ({})),
  CachedMarketDataProvider: jest.fn().mockImplementation(() => ({
    getQuote: jest.fn().mockImplementation(async (symbol: string) => {
      const price = mockQuotePrices[symbol];
      if (!price) return null;
      return { symbol, price, change: 0, changePercent: 0, volume: 1000, timestamp: '2026-01-01' };
    }),
  })),
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
import { createHandler } from '../src/handlers/event-listener';
import { LedgerRepository } from '../src/repositories/ledger.repository';
import { ShadowFillService } from '../src/services/shadow-fill.service';
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

describe('order-ledger event-listener handler', () => {
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

  // Actual stream tests
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
              orderId: 'order-1',
              symbol: 'VTI',
              side: 'BUY',
              quantity: 10,
              fillPrice: 245.50,
            },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockMetrics.addMetric).toHaveBeenCalledWith('EventProcessed', 'Count', 1);
  });

  it('should process ORDER_PARTIALLY_FILLED event', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-2',
        body: {
          detail: {
            id: 'evt-2',
            type: 'ORDER_PARTIALLY_FILLED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: { tenantId: 't1', orderId: 'order-2', symbol: 'SPY', side: 'BUY', quantity: 5, fillPrice: 512.30 },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should process DEPOSIT_DETECTED event', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-3',
        body: {
          detail: {
            id: 'evt-3',
            type: 'DEPOSIT_DETECTED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: { tenantId: 't1', amountCents: 500000 },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should skip unknown event types gracefully', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-4',
        body: {
          detail: {
            id: 'evt-4',
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
            type: 'ORDER_FILLED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: { tenantId: 't1', orderId: 'order-dup' },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
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

  // Simulation tests (merged from simulation-listener.test.ts)
  describe('simulation events (DECISION_PACKET_CREATED)', () => {
    it('should process DECISION_PACKET_CREATED and write simulated LedgerEntries', async () => {
      const sqsEvent = buildSqsEvent([
        {
          messageId: 'msg-sim-1',
          body: {
            detail: {
              id: 'evt-sim-1',
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
      const putCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Put');
      expect(putCalls.length).toBe(2);
    });

    it('should skip decision packets with no proposed trades', async () => {
      const sqsEvent = buildSqsEvent([
        {
          messageId: 'msg-sim-empty',
          body: {
            detail: {
              id: 'evt-sim-empty',
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

    it('should use shadow fill prices for simulated entries', async () => {
      const sqsEvent = buildSqsEvent([
        {
          messageId: 'msg-sim-price',
          body: {
            detail: {
              id: 'evt-sim-price',
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
});
