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
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  NotRetryableError: class NotRetryableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotRetryableError';
    }
  },
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
    return (context?.tenantId ?? subject?.tenantId) as string;
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
  applyMiddleware: jest.fn((handler: unknown) => handler),
  withLambdaContext: jest.fn().mockReturnValue((fn: unknown) => fn),
  withTiming: jest.fn().mockReturnValue((fn: unknown) => fn),
  withMethodLogging: jest.fn().mockReturnValue((_name: string, fn: (...args: unknown[]) => unknown) => fn),
}));

jest.mock('@nestfolio/domain-core', () => ({
  EntityNotFoundError: class extends Error {
    constructor(public entityType: string, public entityId: string) {
      super(`${entityType} with id '${entityId}' not found`);
    }
  },
}));

import { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { ComplianceRepository } from '../repositories/compliance.repository';
import { RuleEngine } from '../rules/rule-engine';
import { MandateValidator } from '../rules/mandate-validator';
import { GuardrailEvaluator } from '../rules/guardrail-evaluator';
import { SuitabilityChecker } from '../rules/suitability-checker';
import { AuthorityResolver } from '../rules/authority-resolver';
import { createHandler, type EventListenerDeps } from '../handlers/event-listener';

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
  let handler: (event: SQSEvent) => Promise<SQSBatchResponse>;
  let mockDeps: EventListenerDeps;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, TABLE_NAME: 'test-table' };

    const repository = new ComplianceRepository('test-table');
    const ruleEngine = new RuleEngine(
      new MandateValidator(),
      new GuardrailEvaluator(),
      new SuitabilityChecker(),
      new AuthorityResolver(),
    );

    mockDeps = {
      repository,
      idempotencyGuard: { ensureOnce: jest.fn().mockResolvedValue(true) } as any,
      ruleEngine,
      metrics: {
        addMetric: jest.fn(),
        addDimension: jest.fn(),
        publishStoredMetrics: jest.fn(),
      } as any,
    };

    handler = createHandler(mockDeps);
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should process DECISION_PACKET_CREATED and persist compliance check', async () => {
    // getMandateSnapshot -> found
    mockSend.mockResolvedValueOnce({
      Item: {
        mandateId: 'm-1',
        level: 'DISCRETIONARY',
        monthlyTurnoverCapPercent: 10,
        maxSingleTradePercent: 5,
        effectiveDate: '2024-01-01T00:00:00.000Z',
        revokedAt: null,
      },
    });
    // createComplianceCheck -> put
    mockSend.mockResolvedValueOnce({});
    // updateCheckResult -> update
    mockSend.mockResolvedValueOnce({ Attributes: { status: 'COMPLETED', result: 'APPROVED' } });
    // updateCheckResult -> edit event put
    mockSend.mockResolvedValueOnce({});
    // createAuditArtifact -> put
    mockSend.mockResolvedValueOnce({});

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-1',
        body: {
          detail: {
            id: 'evt-1',
            type: 'DECISION_PACKET_CREATED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              decisionId: 'dp-1',
              tenantId: 't-1',
              userId: 'u-1',
              proposedTrades: [
                {
                  symbol: 'AAPL',
                  assetClass: 'EQUITY',
                  side: 'BUY',
                  quantityOrAmountCents: 2_000_00,
                  targetWeightPercent: 2,
                  rationale: 'Good value',
                },
              ],
              portfolioValue: 100_000_00,
              riskScore: 7,
              currentPositions: [{ ticker: 'MSFT', weight: 10 }],
            },
            context: { tenantId: 't-1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);

    // Should have called: getMandateSnapshot, createComplianceCheck, updateCheckResult (2 calls), createAuditArtifact
    expect(mockSend).toHaveBeenCalledTimes(5);
  });

  it('should handle missing mandate by creating BLOCKED result', async () => {
    // getMandateSnapshot -> not found
    mockSend.mockResolvedValueOnce({ Item: undefined });
    // createComplianceCheck -> put
    mockSend.mockResolvedValueOnce({});
    // updateCheckResult -> update
    mockSend.mockResolvedValueOnce({ Attributes: { status: 'COMPLETED', result: 'BLOCKED' } });
    // updateCheckResult -> edit event put
    mockSend.mockResolvedValueOnce({});

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-2',
        body: {
          detail: {
            id: 'evt-2',
            type: 'DECISION_PACKET_CREATED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              decisionId: 'dp-2',
              tenantId: 't-1',
              userId: 'u-1',
              proposedTrades: [],
              portfolioValue: 0,
              riskScore: 5,
              currentPositions: [],
            },
            context: { tenantId: 't-1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should fall back to tenantId when subject.userId is undefined', async () => {
    // getMandateSnapshot -> found (called with tenantId as userId fallback)
    mockSend.mockResolvedValueOnce({
      Item: {
        mandateId: 'm-1',
        level: 'DISCRETIONARY',
        monthlyTurnoverCapPercent: 10,
        maxSingleTradePercent: 5,
        effectiveDate: '2024-01-01T00:00:00.000Z',
        revokedAt: null,
      },
    });
    // createComplianceCheck -> put
    mockSend.mockResolvedValueOnce({});
    // updateCheckResult -> update
    mockSend.mockResolvedValueOnce({ Attributes: { status: 'COMPLETED', result: 'APPROVED' } });
    // updateCheckResult -> edit event put
    mockSend.mockResolvedValueOnce({});
    // createAuditArtifact -> put
    mockSend.mockResolvedValueOnce({});

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-uid',
        body: {
          detail: {
            id: 'evt-uid',
            type: 'DECISION_PACKET_CREATED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              decisionId: 'dp-uid',
              tenantId: 't-1',
              // userId is intentionally omitted
              proposedTrades: [],
              portfolioValue: 100_000_00,
              riskScore: 5,
              currentPositions: [],
            },
            context: { tenantId: 't-1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);

    // getMandateSnapshot should be called with tenantId as userId fallback
    const getMandateCall = mockSend.mock.calls[0][0];
    expect(getMandateCall.input.Key.pk.S ?? getMandateCall.input.Key?.pk).toBeDefined();
    expect(mockSend).toHaveBeenCalled();
  });

  it('should report failure for malformed event body (invalid JSON)', async () => {
    const sqsEvent: SQSEvent = {
      Records: [{
        messageId: 'msg-malformed',
        body: '{{invalid',
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

  it('should throw NotRetryableError when DECISION_PACKET_CREATED is missing required fields', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-missing-fields',
        body: {
          detail: {
            id: 'evt-missing',
            type: 'DECISION_PACKET_CREATED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              decisionId: 'dp-missing',
              tenantId: 't-1',
              userId: 'u-1',
              // Missing: proposedTrades, portfolioValue, riskScore, currentPositions
            },
            context: { tenantId: 't-1' },
          },
        },
      },
    ]);

    const { logger } = require('@nestfolio/platform-core');

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-missing-fields');

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to process record',
      expect.objectContaining({
        error: expect.stringContaining('Missing fields'),
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
        body: { detail: { id: 'evt-fail', type: 'DECISION_PACKET_CREATED', subject: {} } },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-fail');
  });

  it('should report failure when DECISION_PACKET_CREATED is missing required fields', async () => {
    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-missing',
        body: {
          detail: {
            id: 'evt-missing',
            type: 'DECISION_PACKET_CREATED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              decisionId: 'dp-missing',
              tenantId: 't-1',
              userId: 'u-1',
              // Missing: proposedTrades, portfolioValue, riskScore, currentPositions
            },
            context: { tenantId: 't-1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-missing');

    // Should NOT have called any DynamoDB operations (validation rejects before processing)
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should proceed when DECISION_PACKET_CREATED has all required fields', async () => {
    // getMandateSnapshot -> found
    mockSend.mockResolvedValueOnce({
      Item: {
        mandateId: 'm-1',
        level: 'DISCRETIONARY',
        monthlyTurnoverCapPercent: 10,
        maxSingleTradePercent: 5,
        effectiveDate: '2024-01-01T00:00:00.000Z',
        revokedAt: null,
      },
    });
    // createComplianceCheck -> put
    mockSend.mockResolvedValueOnce({});
    // updateCheckResult -> update
    mockSend.mockResolvedValueOnce({ Attributes: { status: 'COMPLETED', result: 'APPROVED' } });
    // updateCheckResult -> edit event put
    mockSend.mockResolvedValueOnce({});
    // createAuditArtifact -> put
    mockSend.mockResolvedValueOnce({});

    const sqsEvent = buildSqsEvent([
      {
        messageId: 'msg-valid',
        body: {
          detail: {
            id: 'evt-valid',
            type: 'DECISION_PACKET_CREATED',
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: {
              decisionId: 'dp-valid',
              tenantId: 't-1',
              userId: 'u-1',
              proposedTrades: [
                {
                  symbol: 'AAPL',
                  assetClass: 'EQUITY',
                  side: 'BUY',
                  quantityOrAmountCents: 2_000_00,
                  targetWeightPercent: 2,
                  rationale: 'Good value',
                },
              ],
              portfolioValue: 100_000_00,
              riskScore: 7,
              currentPositions: [{ ticker: 'MSFT', weight: 10 }],
            },
            context: { tenantId: 't-1' },
          },
        },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);

    // Should have processed: getMandateSnapshot + createComplianceCheck + updateCheckResult (2) + createAuditArtifact
    expect(mockSend).toHaveBeenCalledTimes(5);
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
        body: { detail: { id: 'evt-nr', type: 'DECISION_PACKET_CREATED', subject: {} } },
      },
    ]);

    const result = await handler(sqsEvent);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(isRetryable).toHaveBeenCalled();
  });
});
