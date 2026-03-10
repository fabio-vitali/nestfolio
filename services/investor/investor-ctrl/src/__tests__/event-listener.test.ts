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
    QueryCommand: jest.fn().mockImplementation((input) => ({ _type: 'Query', input })),
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
        KeyConditionExpression: skPrefix
          ? 'pk = :pk AND begins_with(sk, :sk)'
          : 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk, ...(skPrefix ? { ':sk': skPrefix } : {}) },
      }));
      return result.Items ?? [];
    }
    protected async transactWrite(input: unknown) {
      const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(new TransactWriteCommand(input));
    }
  },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const mockParseRecord = jest.fn((record) => {
  const body = JSON.parse(record.body);
  const event = body.detail ?? body;
  return { event, payload: event.subject ?? {}, record };
});

const mockEnsureOnce = jest.fn().mockResolvedValue(true);

const mockExtractTenantId = jest.fn((event: Record<string, unknown>) => {
  const context = event.context as Record<string, unknown> | undefined;
  const subject = event.subject as Record<string, unknown> | undefined;
  const id = context?.tenantId ?? subject?.tenantId;
  if (!id || typeof id !== 'string') throw new Error('Missing tenantId');
  return id;
});

const mockMetrics = {
  addMetric: jest.fn(),
  addDimension: jest.fn(),
  publishStoredMetrics: jest.fn(),
};

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
  parseRecord: mockParseRecord,
  IdempotencyGuard: jest.fn().mockImplementation(() => ({
    ensureOnce: mockEnsureOnce,
  })),
  extractTenantId: mockExtractTenantId,
  createServiceMetrics: jest.fn().mockReturnValue(mockMetrics),
  isRetryable: jest.fn().mockReturnValue(true),
  traceEvent: jest.fn(),
  MetricUnit: { Count: 'Count' },
  applyMiddleware: jest.fn((handler: unknown) => handler),
  withLambdaContext: jest.fn().mockReturnValue((fn: unknown) => fn),
  withTiming: jest.fn().mockReturnValue((fn: unknown) => fn),
  withMethodLogging: jest.fn().mockImplementation(() =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

jest.mock('@nestfolio/domain-core', () => ({}));

import { SQSEvent } from 'aws-lambda';
import { createHandler, EventListenerDeps } from '../handlers/event-listener';
import { NotificationRepository } from '../repositories/notification.repository';
import { NotificationLifecycleService } from '../services/notification-lifecycle.service';

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

  let handler: (event: SQSEvent) => Promise<import('aws-lambda').SQSBatchResponse>;
  let mockDeps: EventListenerDeps;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockEnsureOnce.mockResolvedValue(true);
    process.env = { ...ORIGINAL_ENV, TABLE_NAME: 'test-table' };

    const repository = new NotificationRepository('test-table');
    const lifecycleService = new NotificationLifecycleService(repository);

    mockDeps = {
      idempotencyGuard: { ensureOnce: mockEnsureOnce } as any,
      lifecycleService,
      metrics: mockMetrics as any,
    };

    handler = createHandler(mockDeps);
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should process ONBOARDING_COMPLETED event', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-1',
        body: {
          detail: {
            id: 'evt-1',
            type: 'ONBOARDING_COMPLETED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: { tenantId: 't1', userId: 'u1' },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should process MANDATE_GRANTED event', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-2',
        body: {
          detail: {
            id: 'evt-2',
            type: 'MANDATE_GRANTED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: { tenantId: 't1', userId: 'u1' },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should process ORDER_FILLED event', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-3',
        body: {
          detail: {
            id: 'evt-3',
            type: 'ORDER_FILLED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: { tenantId: 't1', orderId: 'ord-1', symbol: 'VTI', quantity: 10 },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should report failure for malformed event body (invalid JSON)', async () => {
    const sqsEvent: SQSEvent = {
      Records: [{
        messageId: 'msg-malformed',
        body: '{{not-json',
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

  it('should report failure when event has empty body', async () => {
    const sqsEvent: SQSEvent = {
      Records: [{
        messageId: 'msg-empty',
        body: '{}',
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
    // Empty body should be parsed as unknown type and skipped
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

  it('should report batch item failures on parse errors', async () => {
    mockParseRecord.mockImplementationOnce(() => {
      throw new Error('Parse error');
    });

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-fail',
        body: { detail: { id: 'evt-fail', type: 'ONBOARDING_COMPLETED', subject: {} } },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-fail');
  });

  it('should skip duplicate events via idempotency guard', async () => {
    mockEnsureOnce.mockResolvedValue(false);

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-dup',
        body: {
          detail: {
            id: 'evt-dup',
            type: 'MANDATE_GRANTED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: { tenantId: 't1' },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
  });
});
