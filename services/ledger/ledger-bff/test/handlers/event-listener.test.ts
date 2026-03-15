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
    GetCommand: jest.fn().mockImplementation((input) => ({ _type: 'Get', input })),
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

import { SQSEvent } from 'aws-lambda';
import { createHandler } from '../../src/handlers/event-listener';
import { PortfolioRepository } from '../../src/repositories/portfolio.repository';
import { BalanceUpdatedPipe } from '../../src/pipes/balance-updated.pipe';
import { PortfolioUpdatedPipe } from '../../src/pipes/portfolio-updated.pipe';
import { LedgerEntryRecordedPipe } from '../../src/pipes/ledger-entry-recorded.pipe';
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

describe('ledger-bff event-listener handler', () => {
  const ORIGINAL_ENV = process.env;

  const mockMetrics = {
    addMetric: jest.fn(),
    addDimension: jest.fn(),
    publishStoredMetrics: jest.fn(),
  };

  const repository = new PortfolioRepository('test-table');
  const balanceUpdatedPipe = new BalanceUpdatedPipe(repository);
  const portfolioUpdatedPipe = new PortfolioUpdatedPipe(repository);
  const ledgerEntryRecordedPipe = new LedgerEntryRecordedPipe(repository);

  let handler: (event: SQSEvent) => Promise<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ Items: [] });
    process.env = { ...ORIGINAL_ENV, TABLE_NAME: 'test-table' };

    handler = createHandler({
      eventPipeMap: {
        BALANCE_UPDATED: [{ name: 'balanceUpdated', pipe: balanceUpdatedPipe }],
        PORTFOLIO_UPDATED: [{ name: 'portfolioUpdated', pipe: portfolioUpdatedPipe }],
        LEDGER_ENTRY_RECORDED: [{ name: 'ledgerEntryRecorded', pipe: ledgerEntryRecordedPipe }],
      },
      bus: { publish: jest.fn().mockResolvedValue(undefined) } as any,
      metrics: mockMetrics as any,
    });
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should process BALANCE_UPDATED event', async () => {
    const sqsEvent = buildSqsEvent([{
      messageId: 'msg-1',
      body: {
        detail: {
          id: 'evt-1',
          type: 'BALANCE_UPDATED',
          timestamp: '2025-01-01T00:00:00.000Z',
          subject: { cashBalanceCents: 950_000, deltaCents: -50_000 },
          context: { tenantId: 't1' },
        },
      },
    }]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockMetrics.addMetric).toHaveBeenCalledWith('EventProcessed', 'Count', 1);

    // Verify upsertBalance was called (Update command)
    const updateCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Update');
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0][0].input.Key.pk).toBe('Portfolio#t1');
  });

  it('should process PORTFOLIO_UPDATED event with positions', async () => {
    const sqsEvent = buildSqsEvent([{
      messageId: 'msg-2',
      body: {
        detail: {
          id: 'evt-2',
          type: 'PORTFOLIO_UPDATED',
          timestamp: '2025-01-01T00:00:00.000Z',
          subject: {
            positions: {
              VTI: { symbol: 'VTI', quantity: 10, averageCostBasis: 250, totalCostBasis: 2500, lastFillPrice: 251 },
            },
          },
          context: { tenantId: 't1' },
        },
      },
    }]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);

    // Verify upsertPosition was called (Put command)
    const putCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Put');
    expect(putCalls.length).toBe(1);
    expect(putCalls[0][0].input.Item.pk).toBe('Portfolio#t1');
    expect(putCalls[0][0].input.Item.sk).toBe('Position#VTI');
  });

  it('should process LEDGER_ENTRY_RECORDED event', async () => {
    const sqsEvent = buildSqsEvent([{
      messageId: 'msg-3',
      body: {
        detail: {
          id: 'evt-3',
          type: 'LEDGER_ENTRY_RECORDED',
          timestamp: '2025-01-01T00:00:00.000Z',
          subject: {
            eventId: 'entry-1',
            eventType: 'ORDER_FILLED',
            payload: { symbol: 'VTI', quantity: 10 },
            timestamp: '2025-01-01T00:00:00.000Z',
            sequenceNo: 1,
          },
          context: { tenantId: 't1' },
        },
      },
    }]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);

    // Verify appendHistory was called (Put command for History#)
    const putCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Put');
    expect(putCalls.length).toBe(1);
    expect(putCalls[0][0].input.Item.pk).toBe('History#t1');
  });

  it('should skip unknown event types gracefully', async () => {
    const sqsEvent = buildSqsEvent([{
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
    }]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should report batch item failures for processing errors', async () => {
    const { parseRecord } = require('@nestfolio/lambda-utils');
    (parseRecord as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Parse error');
    });

    const sqsEvent = buildSqsEvent([{
      messageId: 'msg-fail',
      body: { detail: { id: 'evt-fail', type: 'BALANCE_UPDATED', subject: {} } },
    }]);

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

    const sqsEvent = buildSqsEvent([{
      messageId: 'msg-nr',
      body: { detail: { id: 'evt-nr', type: 'BALANCE_UPDATED', subject: {} } },
    }]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(isRetryable).toHaveBeenCalled();
  });

  it('should handle simulated LEDGER_ENTRY_RECORDED with simulation upserts', async () => {
    const sqsEvent = buildSqsEvent([{
      messageId: 'msg-sim',
      body: {
        detail: {
          id: 'evt-sim',
          type: 'LEDGER_ENTRY_RECORDED',
          timestamp: '2025-01-01T00:00:00.000Z',
          subject: {
            eventId: 'entry-sim',
            eventType: 'ORDER_FILLED',
            payload: { symbol: 'SPY', quantity: 5 },
            timestamp: '2025-01-01T00:00:00.000Z',
            sequenceNo: 1,
            streamType: 'simulated',
            cashBalanceCents: 800_000,
            positions: {
              SPY: { symbol: 'SPY', quantity: 5, averageCostBasis: 520, totalCostBasis: 2600, lastFillPrice: 521 },
            },
          },
          context: { tenantId: 't1' },
        },
      },
    }]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);

    // History entry + Simulation Latest + Simulation Position
    const putCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Put');
    expect(putCalls.length).toBe(3);
    expect(putCalls[0][0].input.Item.pk).toBe('History#t1');
    expect(putCalls[1][0].input.Item.pk).toBe('Simulation#t1');
    expect(putCalls[1][0].input.Item.sk).toBe('Latest');
    expect(putCalls[2][0].input.Item.pk).toBe('Simulation#t1');
    expect(putCalls[2][0].input.Item.sk).toBe('Position#SPY');
  });
});
