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
}));

jest.mock('@nestfolio/domain-core', () => ({}));

import { SQSEvent } from 'aws-lambda';

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

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, TABLE_NAME: 'test-table' };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should process DECISION_PACKET_CREATED event and store decision', async () => {
    // IdempotencyGuard.ensureOnce -> true, then storeDecision -> put
    mockSend.mockResolvedValueOnce({}); // idempotency put
    mockSend.mockResolvedValueOnce({}); // storeDecision put

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
              decisionId: 'd1',
              trigger: 'REBALANCE',
              proposedTrades: [],
              explanation: 'Portfolio rebalance needed',
              confirmationRequired: true,
            },
            context: { tenantId: 't1' },
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

  it('should process DECISION_APPROVED event and update status', async () => {
    // transactWrite for updateDecisionStatus
    mockSend.mockResolvedValueOnce({});

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-2',
        body: {
          detail: {
            id: 'evt-2',
            type: 'DECISION_APPROVED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: { tenantId: 't1', decisionId: 'd1' },
            context: { tenantId: 't1' },
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

  it('should process DECISION_BLOCKED event and update status', async () => {
    // transactWrite for updateDecisionStatus
    mockSend.mockResolvedValueOnce({});

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-3',
        body: {
          detail: {
            id: 'evt-3',
            type: 'DECISION_BLOCKED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: { tenantId: 't1', decisionId: 'd1' },
            context: { tenantId: 't1' },
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

  it('should skip duplicate events via idempotency guard', async () => {
    const { IdempotencyGuard } = require('@nestfolio/lambda-utils');

    // Override IdempotencyGuard to return false (duplicate)
    const ensureOnceMock = jest.fn().mockResolvedValue(false);
    (IdempotencyGuard as jest.Mock).mockImplementation(() => ({
      ensureOnce: ensureOnceMock,
    }));

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-dup',
        body: {
          detail: {
            id: 'evt-dup',
            type: 'DECISION_PACKET_CREATED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: { tenantId: 't1', decisionId: 'd1' },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/event-listener');
      const result = await handler(sqsEvent);
      expect(result.batchItemFailures).toHaveLength(0);
      // No DynamoDB calls for pipe processing since event is duplicate
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  it('should report failure for malformed event body (invalid JSON)', async () => {
    const sqsEvent: SQSEvent = {
      Records: [{
        messageId: 'msg-malformed',
        body: '{{invalid-json',
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
        body: { detail: { id: 'evt-fail', type: 'DECISION_PACKET_CREATED', subject: {} } },
      },
    ]);

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/event-listener');
      const result = await handler(sqsEvent);
      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-fail');
    });
  });
});
