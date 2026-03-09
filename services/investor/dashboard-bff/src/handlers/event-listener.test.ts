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
  },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const mockEnsureOnce = jest.fn().mockResolvedValue(true);

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
  parseRecord: jest.fn((record) => {
    const body = JSON.parse(record.body);
    const event = body.detail ?? body;
    return { event, payload: event.subject ?? {}, record };
  }),
  IdempotencyGuard: jest.fn().mockImplementation(() => ({
    ensureOnce: mockEnsureOnce,
  })),
  createServiceMetrics: jest.fn().mockReturnValue({
    addMetric: jest.fn(),
    addDimension: jest.fn(),
    publishStoredMetrics: jest.fn(),
  }),
  isRetryable: jest.fn().mockReturnValue(true),
  traceEvent: jest.fn(),
  MetricUnit: { Count: 'Count' },
}));

process.env.TABLE_NAME = 'test-table';

import { SQSEvent } from 'aws-lambda';
import { handler } from './event-listener';

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

describe('dashboard-bff event-listener handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockEnsureOnce.mockResolvedValue(true);
  });

  it('should process ORDER_FILLED event through multiple pipes', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-1',
        body: {
          detail: {
            id: 'evt-1',
            type: 'ORDER_FILLED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              orderId: 'o1',
              brokerOrderId: 'bo1',
              symbol: 'AAPL',
              filledQuantity: 50,
              averageFillPrice: 150.00,
              filledAt: '2025-01-01T00:00:00.000Z',
            },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);

    // ORDER_FILLED triggers 3 pipes: portfolioSummary (Update), positionSnapshot (Put), recentActivity (Put)
    expect(mockSend).toHaveBeenCalled();
    expect(mockSend.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('should process DECISION_APPROVED through advisory and activity pipes', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-2',
        body: {
          detail: {
            id: 'evt-2',
            type: 'DECISION_APPROVED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              decisionId: 'd1',
              complianceLevel: 'L1',
              approvedAt: '2025-01-01T00:00:00.000Z',
            },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);

    // DECISION_APPROVED triggers advisoryStatusPipe (Update) + recentActivityPipe (Put)
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('should process ONBOARDING_COMPLETED through investor snapshot pipe', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-3',
        body: {
          detail: {
            id: 'evt-3',
            type: 'ONBOARDING_COMPLETED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              tenantId: 't1',
              operatingMode: 'BALANCED',
              riskScore: 7,
              goalId: 'g1',
            },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);

    // ONBOARDING_COMPLETED triggers investorSnapshotPipe (Update)
    expect(mockSend).toHaveBeenCalledTimes(1);
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

  it('should report failure when idempotency guard throws DynamoDB error', async () => {
    mockEnsureOnce.mockRejectedValueOnce(new Error('ProvisionedThroughputExceededException'));

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-dynamo-err',
        body: {
          detail: {
            id: 'evt-dynamo',
            type: 'ORDER_FILLED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              orderId: 'o1',
              symbol: 'AAPL',
              filledQuantity: 50,
              averageFillPrice: 150.00,
            },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-dynamo-err');
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
    expect(mockSend).not.toHaveBeenCalled();
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

  it('should process DEPOSIT_DETECTED as activity only', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-5',
        body: {
          detail: {
            id: 'evt-5',
            type: 'DEPOSIT_DETECTED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              depositId: 'dep-1',
              amountCents: 500000,
              currency: 'EUR',
              detectedAt: '2025-01-01T00:00:00.000Z',
            },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
    // DEPOSIT_DETECTED triggers only recentActivityPipe (1 put)
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('should process GOAL_UPDATED through investor snapshot pipe', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-6',
        body: {
          detail: {
            id: 'evt-6',
            type: 'GOAL_UPDATED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              goalId: 'g1',
              objective: 'Retirement',
              timeHorizonMonths: 360,
              targetReturn: 0.07,
            },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('should skip all pipes when all per-pipe idempotency keys are duplicates', async () => {
    mockEnsureOnce.mockResolvedValue(false);

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-dup',
        body: {
          detail: {
            id: 'evt-dup',
            type: 'ORDER_FILLED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              orderId: 'o1',
              symbol: 'AAPL',
              filledQuantity: 50,
              averageFillPrice: 150.00,
            },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
    // 3 idempotency checks for ORDER_FILLED (portfolioSummary, positionSnapshot, recentActivity)
    expect(mockEnsureOnce).toHaveBeenCalledTimes(3);
    // No DynamoDB calls for pipe processing — only idempotency checks happened
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should use per-pipe idempotency keys with format eventType#eventId#pipeName', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-idem',
        body: {
          detail: {
            id: 'evt-100',
            type: 'DECISION_APPROVED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              decisionId: 'd1',
              approvedAt: '2025-01-01T00:00:00.000Z',
            },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);

    // DECISION_APPROVED has 2 pipes: advisoryStatus, recentActivity
    expect(mockEnsureOnce).toHaveBeenCalledTimes(2);
    expect(mockEnsureOnce).toHaveBeenCalledWith('DECISION_APPROVED', 'DECISION_APPROVED#evt-100#advisoryStatus');
    expect(mockEnsureOnce).toHaveBeenCalledWith('DECISION_APPROVED', 'DECISION_APPROVED#evt-100#recentActivity');
  });

  it('should skip only already-processed pipes and run remaining pipes', async () => {
    // First pipe (advisoryStatus) already processed, second (recentActivity) is new
    mockEnsureOnce
      .mockResolvedValueOnce(false)  // advisoryStatus — already processed
      .mockResolvedValueOnce(true);  // recentActivity — new

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-partial',
        body: {
          detail: {
            id: 'evt-partial',
            type: 'DECISION_APPROVED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              decisionId: 'd1',
              approvedAt: '2025-01-01T00:00:00.000Z',
            },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);

    // Only 1 pipe should have run (recentActivity), not advisoryStatus
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('should process DECISION_PACKET_CREATED through advisory pipe', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-7',
        body: {
          detail: {
            id: 'evt-7',
            type: 'DECISION_PACKET_CREATED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              decisionId: 'd1',
              trigger: 'DRIFT',
              tenantId: 't1',
            },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
