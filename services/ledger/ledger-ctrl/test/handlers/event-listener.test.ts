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
    protected async putIfNotExists(item: Record<string, unknown>): Promise<boolean> {
      try {
        const { PutCommand } = require('@aws-sdk/lib-dynamodb');
        await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item, ConditionExpression: 'attribute_not_exists(pk)' }));
        return true;
      } catch (error: unknown) {
        if ((error as any).name === 'ConditionalCheckFailedException') return false;
        throw error;
      }
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
import { createHandler } from '../../src/handlers/event-listener';
import { LedgerRepository } from '../../src/repositories/ledger.repository';
import { ShadowFillService } from '../../src/services/shadow-fill.service';

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

describe('ledger-ctrl event-listener handler', () => {
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
      bus: { publish: jest.fn().mockResolvedValue(undefined) } as any,
      metrics: mockMetrics as any,
      shadowFill,
    });
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should process DEPOSIT_DETECTED as actual event', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-1',
        body: {
          detail: {
            id: 'evt-1',
            type: 'DEPOSIT_DETECTED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: { tenantId: 't1', depositId: 'd1', amountCents: 500000, depositedAt: '2025-01-01T00:00:00.000Z' },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockMetrics.addMetric).toHaveBeenCalledWith('EventProcessed', 'Count', 1);
  });

  it('should process CORPORATE_ACTION_PROCESSED event', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-ca',
        body: {
          detail: {
            id: 'evt-ca',
            type: 'CORPORATE_ACTION_PROCESSED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: { tenantId: 't1', actionId: 'ca1', symbol: 'AAPL', actionType: 'STOCK_SPLIT', quantityMultiplier: 2, costBasisDivisor: 2, appliedAt: '2025-01-01T00:00:00.000Z' },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockMetrics.addMetric).toHaveBeenCalledWith('EventProcessed', 'Count', 1);
  });

  it('should process DECISION_PACKET_CREATED as simulation event', async () => {
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
  });

  it('should skip duplicate actual event when putLedgerEntry returns false', async () => {
    // First call: nextSequence (UpdateCommand), Second call: putIfNotExists (PutCommand) → ConditionalCheckFailedException
    mockSend
      .mockResolvedValueOnce({ Attributes: { lastSequence: 1 } }) // nextSequence
      .mockRejectedValueOnce(Object.assign(new Error('Conditional'), { name: 'ConditionalCheckFailedException' })); // putIfNotExists

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
    expect(mockMetrics.addMetric).not.toHaveBeenCalledWith('EventProcessed', expect.anything(), expect.anything());
  });

  it('should skip duplicate simulation entries per trade', async () => {
    // For simulation: each trade calls nextSequence then putIfNotExists
    // First trade succeeds, second trade is duplicate
    mockSend
      .mockResolvedValueOnce({ Attributes: { lastSequence: 1 } }) // nextSequence for trade 1
      .mockResolvedValueOnce({}) // putIfNotExists for trade 1 — success
      .mockResolvedValueOnce({ Attributes: { lastSequence: 2 } }) // nextSequence for trade 2
      .mockRejectedValueOnce(Object.assign(new Error('Conditional'), { name: 'ConditionalCheckFailedException' })); // putIfNotExists for trade 2 — duplicate

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-sim-dup',
        body: {
          detail: {
            id: 'evt-sim-dup',
            type: 'DECISION_PACKET_CREATED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              tenantId: 't1',
              decisionPacketId: 'dp-dup',
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
  });

  it('should use deterministic simulation event IDs', async () => {
    mockSend.mockResolvedValue({ Items: [], Attributes: { lastSequence: 1 } });

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-det',
        body: {
          detail: {
            id: 'evt-det-1',
            type: 'DECISION_PACKET_CREATED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              tenantId: 't1',
              decisionPacketId: 'dp-det',
              proposedTrades: [
                { symbol: 'VTI', side: 'BUY', quantity: 10 },
              ],
            },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    await handler(sqsEvent);

    // Check PutCommand was called with deterministic eventId and new sk format
    const { PutCommand } = require('@aws-sdk/lib-dynamodb');
    const putCalls = (PutCommand as jest.Mock).mock.calls;
    const ledgerPut = putCalls.find(
      (c: any) => c[0]?.Item?.sk === 'Event#evt-det-1-sim-VTI',
    );
    expect(ledgerPut).toBeDefined();
    expect(ledgerPut[0].Item.eventId).toBe('evt-det-1-sim-VTI');
    expect(ledgerPut[0].Item.sourceEventId).toBe('evt-det-1-sim-VTI');
  });

  it('should skip unknown event types', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-unknown',
        body: {
          detail: {
            id: 'evt-unknown',
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

  it('should report retryable failures in batchItemFailures', async () => {
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
  });
});
