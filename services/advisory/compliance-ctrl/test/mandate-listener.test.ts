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

const mockIsRetryable = jest.fn();

class MockNotRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotRetryableError';
  }
}

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
  isRetryable: mockIsRetryable,
  NotRetryableError: MockNotRetryableError,
  createServiceMetrics: jest.fn().mockReturnValue({
    addMetric: jest.fn(),
    publishStoredMetrics: jest.fn(),
  }),
  MetricUnit: { Count: 'Count' },
  traceEvent: jest.fn(),
  applyMiddleware: jest.fn((handler: unknown) => handler),
  withLambdaContext: jest.fn().mockReturnValue((fn: unknown) => fn),
  withTiming: jest.fn().mockReturnValue((fn: unknown) => fn),
  withMethodLogging: jest.fn().mockReturnValue((_name: string, fn: (...args: unknown[]) => unknown) => fn),
  publishErrorEvent: jest.fn().mockResolvedValue(undefined),
  EventBridgeBus: jest.fn(),
}));

import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { ComplianceRepository } from '../src/repositories/compliance.repository';
import { createHandler, type MandateListenerDeps } from '../src/handlers/mandate-listener';

function buildSqsEvent(
  records: Array<{ messageId: string; body: Record<string, unknown> }>,
): SQSEvent {
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

describe('mandate-listener handler', () => {
  const ORIGINAL_ENV = process.env;
  let handler: (event: SQSEvent) => Promise<SQSBatchResponse>;
  let mockDeps: MandateListenerDeps;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, TABLE_NAME: 'test-table' };
    mockIsRetryable.mockReturnValue(true);

    const repository = new ComplianceRepository('test-table');

    const { createServiceMetrics } = require('@nestfolio/lambda-utils');
    mockDeps = {
      repository,
      idempotencyGuard: { ensureOnce: jest.fn().mockResolvedValue(true) } as any,
      bus: { publish: jest.fn().mockResolvedValue(undefined) } as any,
      metrics: createServiceMetrics('compliance-ctrl'),
    };

    handler = createHandler(mockDeps);
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should process MANDATE_GRANTED event and persist snapshot', async () => {
    mockSend.mockResolvedValueOnce({});

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-1',
        body: {
          detail: {
            id: 'evt-1',
            type: 'MANDATE_GRANTED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              tenantId: 't-1',
              userId: 'u-1',
              mandateId: 'm-1',
              level: 'DISCRETIONARY',
              monthlyTurnoverCapPercent: 10,
              maxSingleTradePercent: 5,
              effectiveDate: '2025-01-01T00:00:00.000Z',
            },
            context: { tenantId: 't-1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('should NOT push non-retryable errors to failures', async () => {
    mockIsRetryable.mockReturnValue(false);

    // Make the putMandateSnapshot fail
    mockSend.mockRejectedValueOnce(new Error('ConditionalCheckFailed'));

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-not-retryable',
        body: {
          detail: {
            id: 'evt-nr',
            type: 'MANDATE_GRANTED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              tenantId: 't-1',
              userId: 'u-1',
              mandateId: 'm-1',
              level: 'DISCRETIONARY',
              monthlyTurnoverCapPercent: 10,
              maxSingleTradePercent: 5,
              effectiveDate: '2025-01-01T00:00:00.000Z',
            },
            context: { tenantId: 't-1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    // Non-retryable errors should NOT be added to batchItemFailures
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should push retryable errors to failures', async () => {
    mockIsRetryable.mockReturnValue(true);

    // Make the putMandateSnapshot fail
    mockSend.mockRejectedValueOnce(new Error('ServiceUnavailable'));

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-retryable',
        body: {
          detail: {
            id: 'evt-r',
            type: 'MANDATE_GRANTED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              tenantId: 't-1',
              userId: 'u-1',
              mandateId: 'm-1',
              level: 'DISCRETIONARY',
              monthlyTurnoverCapPercent: 10,
              maxSingleTradePercent: 5,
              effectiveDate: '2025-01-01T00:00:00.000Z',
            },
            context: { tenantId: 't-1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    // Retryable errors SHOULD be added to batchItemFailures
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-retryable');
  });

  it('should process MANDATE_REVOKED event', async () => {
    mockSend.mockResolvedValueOnce({});

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-revoke',
        body: {
          detail: {
            id: 'evt-revoke',
            type: 'MANDATE_REVOKED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              tenantId: 't-1',
              userId: 'u-1',
              mandateId: 'm-1',
              revokedAt: '2025-01-01T00:00:00.000Z',
            },
            context: { tenantId: 't-1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('should skip unknown event types gracefully', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-unknown',
        body: {
          detail: {
            id: 'evt-unknown',
            type: 'SOME_UNKNOWN_TYPE',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: { tenantId: 't-1' },
            context: { tenantId: 't-1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should throw on MANDATE_GRANTED with missing required fields', async () => {
    mockIsRetryable.mockReturnValue(true);

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-missing',
        body: {
          detail: {
            id: 'evt-missing',
            type: 'MANDATE_GRANTED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              tenantId: 't-1',
              userId: 'u-1',
              // mandateId and level are missing
            },
            context: { tenantId: 't-1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-missing');
  });
});
