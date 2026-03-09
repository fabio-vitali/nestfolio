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
    protected async queryAll(input: unknown) {
      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const result = await this.docClient.send(new QueryCommand(input));
      return result.Items ?? [];
    }
    protected async transactWrite(input: unknown) {
      const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(new TransactWriteCommand(input));
    }
  },
  NotRetryableError: class NotRetryableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotRetryableError';
    }
  },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
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
    return (context?.tenantId ?? subject?.tenantId ?? 'unknown') as string;
  }),
  NotRetryableError: class NotRetryableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotRetryableError';
    }
  },
  createServiceMetrics: jest.fn().mockReturnValue({
    addMetric: jest.fn(),
    addDimension: jest.fn(),
    publishStoredMetrics: jest.fn(),
  }),
  isRetryable: jest.fn().mockReturnValue(true),
  traceEvent: jest.fn(),
  MetricUnit: { Count: 'Count' },
}));

import { SQSEvent } from 'aws-lambda';

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

describe('event-listener handler', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, TABLE_NAME: 'test-table' };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should process ORDER_SUBMITTED and fill a valid BUY order', async () => {
    // getCashBalance (lazy init check) -> found
    mockSend.mockResolvedValueOnce({
      Item: { balance: 100000 },
    });
    // getCashBalance (simulation engine) -> found
    mockSend.mockResolvedValueOnce({
      Item: { balance: 100000 },
    });
    // getPosition -> not found
    mockSend.mockResolvedValueOnce({ Item: undefined });
    // getPosition (inside executeTrade) -> not found
    mockSend.mockResolvedValueOnce({ Item: undefined });
    // transactWrite (executeTrade) -> success
    mockSend.mockResolvedValueOnce({});

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-1',
        body: {
          detail: {
            id: 'evt-1',
            type: 'ORDER_SUBMITTED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              orderId: 'order-1',
              tenantId: 't-1',
              userId: 'u-1',
              symbol: 'VTI',
              side: 'BUY',
              quantity: 10,
            },
            context: { tenantId: 't-1' },
          },
        },
      },
    ]);

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/event-listener');
      const result = await handler(sqsEvent);
      expect(result.batchItemFailures).toHaveLength(0);
    });
  });

  it('should process WITHDRAWAL_REQUESTED and complete a valid withdrawal', async () => {
    // getCashBalance -> found
    mockSend.mockResolvedValueOnce({
      Item: { balance: 100000 },
    });
    // initializeCashBalance -> success
    mockSend.mockResolvedValueOnce({});

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-2',
        body: {
          detail: {
            id: 'evt-2',
            type: 'WITHDRAWAL_REQUESTED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              withdrawalId: 'w-1',
              tenantId: 't-1',
              userId: 'u-1',
              amount: 5000,
            },
            context: { tenantId: 't-1' },
          },
        },
      },
    ]);

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/event-listener');
      const result = await handler(sqsEvent);
      expect(result.batchItemFailures).toHaveLength(0);
    });
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

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/event-listener');
      const result = await handler(sqsEvent);
      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-malformed');
    });
  });

  it('should report failure when ORDER_SUBMITTED is missing required fields', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-missing-order-fields',
        body: {
          detail: {
            id: 'evt-missing-fields',
            type: 'ORDER_SUBMITTED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              tenantId: 't-1',
              userId: 'u-1',
              // Missing: orderId, symbol, side, quantity
            },
            context: { tenantId: 't-1' },
          },
        },
      },
    ]);

    const { logger } = require('@nestfolio/platform-core');

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/event-listener');
      const result = await handler(sqsEvent);
      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-missing-order-fields');
    });

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to process record',
      expect.objectContaining({
        error: expect.stringContaining('Missing required ORDER_SUBMITTED fields'),
      }),
    );
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
            context: { tenantId: 't-1' },
          },
        },
      },
    ]);

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/event-listener');
      const result = await handler(sqsEvent);
      expect(result.batchItemFailures).toHaveLength(0);
    });
  });

  it('should report batch item failures for processing errors', async () => {
    const { parseRecord } = require('@nestfolio/lambda-utils');
    (parseRecord as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Parse error');
    });

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-fail',
        body: { detail: { id: 'evt-fail', type: 'ORDER_SUBMITTED', subject: {} } },
      },
    ]);

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/event-listener');
      const result = await handler(sqsEvent);
      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-fail');
    });
  });

  it('should skip duplicate ORDER_SUBMITTED event', async () => {
    const mockEnsureOnce = jest.fn().mockResolvedValue(false);
    const { IdempotencyGuard } = require('@nestfolio/lambda-utils');
    (IdempotencyGuard as jest.Mock).mockImplementation(() => ({
      ensureOnce: mockEnsureOnce,
    }));

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-dup-order',
        body: {
          detail: {
            id: 'evt-dup-order',
            type: 'ORDER_SUBMITTED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              orderId: 'order-dup',
              tenantId: 't-1',
              userId: 'u-1',
              symbol: 'VTI',
              side: 'BUY',
              quantity: 10,
            },
            context: { tenantId: 't-1' },
          },
        },
      },
    ]);

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/event-listener');
      const result = await handler(sqsEvent);
      expect(result.batchItemFailures).toHaveLength(0);
    });

    // Idempotency guard was called, but no DynamoDB operations for the order itself
    expect(mockEnsureOnce).toHaveBeenCalledWith('ORDER_SUBMITTED', 'evt-dup-order');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should skip duplicate WITHDRAWAL_REQUESTED event', async () => {
    const mockEnsureOnce = jest.fn().mockResolvedValue(false);
    const { IdempotencyGuard } = require('@nestfolio/lambda-utils');
    (IdempotencyGuard as jest.Mock).mockImplementation(() => ({
      ensureOnce: mockEnsureOnce,
    }));

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-dup-withdraw',
        body: {
          detail: {
            id: 'evt-dup-withdraw',
            type: 'WITHDRAWAL_REQUESTED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              withdrawalId: 'w-dup',
              tenantId: 't-1',
              userId: 'u-1',
              amount: 5000,
            },
            context: { tenantId: 't-1' },
          },
        },
      },
    ]);

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/event-listener');
      const result = await handler(sqsEvent);
      expect(result.batchItemFailures).toHaveLength(0);
    });

    // Idempotency guard was called, but no DynamoDB operations for the withdrawal itself
    expect(mockEnsureOnce).toHaveBeenCalledWith('WITHDRAWAL_REQUESTED', 'evt-dup-withdraw');
    expect(mockSend).not.toHaveBeenCalled();

    // Restore default IdempotencyGuard mock
    const { IdempotencyGuard: Guard } = require('@nestfolio/lambda-utils');
    (Guard as jest.Mock).mockImplementation(() => ({
      ensureOnce: jest.fn().mockResolvedValue(true),
    }));
  });

  it('should throw descriptive error when ORDER_SUBMITTED has null subject', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-null-subject-order',
        body: {
          detail: {
            id: 'evt-null-subject',
            type: 'ORDER_SUBMITTED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: null,
            context: { tenantId: 't-1' },
          },
        },
      },
    ]);

    const { logger } = require('@nestfolio/platform-core');

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/event-listener');
      const result = await handler(sqsEvent);
      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-null-subject-order');
    });

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to process record',
      expect.objectContaining({
        error: expect.stringContaining('Missing subject in ORDER_SUBMITTED event'),
      }),
    );
  });

  it('should throw descriptive error when WITHDRAWAL_REQUESTED has null subject', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-null-subject-withdraw',
        body: {
          detail: {
            id: 'evt-null-subject-w',
            type: 'WITHDRAWAL_REQUESTED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: null,
            context: { tenantId: 't-1' },
          },
        },
      },
    ]);

    const { logger } = require('@nestfolio/platform-core');

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/event-listener');
      const result = await handler(sqsEvent);
      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-null-subject-withdraw');
    });

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to process record',
      expect.objectContaining({
        error: expect.stringContaining('Missing subject in WITHDRAWAL_REQUESTED event'),
      }),
    );
  });

  it('should initialize account on first ORDER_SUBMITTED if no cash balance exists', async () => {
    // getCashBalance (lazy init check) -> not found
    mockSend.mockResolvedValueOnce({ Item: undefined });
    // initializeCashBalance -> success
    mockSend.mockResolvedValueOnce({});
    // getCashBalance (simulation engine) -> found (after init)
    mockSend.mockResolvedValueOnce({ Item: { balance: 100000 } });
    // getPosition -> not found
    mockSend.mockResolvedValueOnce({ Item: undefined });
    // getPosition (inside executeTrade) -> not found
    mockSend.mockResolvedValueOnce({ Item: undefined });
    // transactWrite -> success
    mockSend.mockResolvedValueOnce({});

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-init',
        body: {
          detail: {
            id: 'evt-init',
            type: 'ORDER_SUBMITTED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              orderId: 'order-init',
              tenantId: 't-1',
              userId: 'u-1',
              symbol: 'VTI',
              side: 'BUY',
              quantity: 2,
            },
            context: { tenantId: 't-1' },
          },
        },
      },
    ]);

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/event-listener');
      const result = await handler(sqsEvent);
      expect(result.batchItemFailures).toHaveLength(0);
    });

    // Should have called initializeCashBalance (the PutCommand for cash init)
    // The second mockSend call should be the initialization
    const secondCall = mockSend.mock.calls[1][0];
    expect(secondCall.input.Item).toMatchObject({
      __typename: 'VirtualCashBalance',
      balance: 100000,
    });
  });
});
