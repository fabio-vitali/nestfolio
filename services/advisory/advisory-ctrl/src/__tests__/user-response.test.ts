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
  withMethodLogging: () => (_name: string, fn: (...args: unknown[]) => unknown) => fn,
}));

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

function extractUpdateAttrs(update: any): Record<string, unknown> {
  const names = update.ExpressionAttributeNames;
  const values = update.ExpressionAttributeValues;
  const result: Record<string, unknown> = {};
  for (const [nameKey, attrName] of Object.entries(names)) {
    const idx = nameKey.replace('#a', '');
    result[attrName as string] = values[`:v${idx}`];
  }
  return result;
}

describe('user-response handler', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    process.env = { ...ORIGINAL_ENV, TABLE_NAME: 'test-table' };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should handle USER_CONFIRMED and update status to CONFIRMED', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-1',
        body: {
          detail: {
            id: 'evt-1',
            type: 'USER_CONFIRMED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: { tenantId: 't1', decisionId: 'dp-1' },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/user-response');
      const result = await handler(sqsEvent);
      expect(result.batchItemFailures).toHaveLength(0);

      const transactCalls = mockSend.mock.calls.filter(
        (c) => c[0]._type === 'TransactWrite',
      );
      expect(transactCalls.length).toBeGreaterThanOrEqual(1);
      const lastTransact = transactCalls[transactCalls.length - 1][0];
      const attrs = extractUpdateAttrs(lastTransact.input.TransactItems[0].Update);
      expect(attrs).toMatchObject({
        status: 'CONFIRMED',
      });
    });
  });

  it('should handle USER_REJECTED and update status to REJECTED', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-2',
        body: {
          detail: {
            id: 'evt-2',
            type: 'USER_REJECTED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              tenantId: 't1',
              decisionId: 'dp-2',
              reason: 'Too risky',
            },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/user-response');
      const result = await handler(sqsEvent);
      expect(result.batchItemFailures).toHaveLength(0);

      const transactCalls = mockSend.mock.calls.filter(
        (c) => c[0]._type === 'TransactWrite',
      );
      expect(transactCalls.length).toBeGreaterThanOrEqual(1);
      const lastTransact = transactCalls[transactCalls.length - 1][0];
      const attrs = extractUpdateAttrs(lastTransact.input.TransactItems[0].Update);
      expect(attrs).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'Too risky',
      });
    });
  });

  it('should skip unhandled event types', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-3',
        body: {
          detail: {
            id: 'evt-3',
            type: 'SOME_OTHER_EVENT',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {},
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/user-response');
      const result = await handler(sqsEvent);
      expect(result.batchItemFailures).toHaveLength(0);
      // No transact calls should happen for unknown event types
      const transactCalls = mockSend.mock.calls.filter(
        (c) => c[0]._type === 'TransactWrite',
      );
      expect(transactCalls).toHaveLength(0);
    });
  });

  it('should report batch item failures on error', async () => {
    const { parseRecord } = require('@nestfolio/lambda-utils');
    (parseRecord as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Parse error');
    });

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-fail',
        body: { detail: { id: 'evt-fail', type: 'USER_CONFIRMED', subject: {} } },
      },
    ]);

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/user-response');
      const result = await handler(sqsEvent);
      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-fail');
    });
  });

  it('should skip duplicate events via idempotency guard', async () => {
    const { IdempotencyGuard } = require('@nestfolio/lambda-utils');
    (IdempotencyGuard as jest.Mock).mockImplementation(() => ({
      ensureOnce: jest.fn().mockResolvedValue(false),
    }));

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-dup',
        body: {
          detail: {
            id: 'evt-dup',
            type: 'USER_CONFIRMED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: { tenantId: 't1', decisionId: 'dp-dup' },
            context: { tenantId: 't1' },
          },
        },
      },
    ]);

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/user-response');
      const result = await handler(sqsEvent);
      expect(result.batchItemFailures).toHaveLength(0);
      // No transact calls should happen for duplicates
      const transactCalls = mockSend.mock.calls.filter(
        (c) => c[0]._type === 'TransactWrite',
      );
      expect(transactCalls).toHaveLength(0);
    });
  });
});
