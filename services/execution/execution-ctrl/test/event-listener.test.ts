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
    DeleteCommand: jest.fn().mockImplementation((input) => ({ _type: 'Delete', input })),
    TransactWriteCommand: jest.fn().mockImplementation((input) => ({ _type: 'TransactWrite', input })),
  };
});

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
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
    protected async putIfNotExists(_item: Record<string, unknown>): Promise<boolean> {
      return true;
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

  requireEnv: (name: string) => process.env[name] ?? name,
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),

}));
import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../src/handlers/event-listener';
import { OrderRepository } from '../src/repositories/order.repository';
import { SafetyChecksService } from '../src/services/safety-checks.service';
import { MarketHoursService } from '../src/services/market-hours.service';
import { OrderLifecycleService } from '../src/services/order-lifecycle.service';

describe('event-listener handler', () => {
  const ORIGINAL_ENV = process.env;

  const repository = new OrderRepository('test-table');
  const safetyChecks = new SafetyChecksService(repository);
  const marketHours = new MarketHoursService();
  const lifecycleService = new OrderLifecycleService(repository, safetyChecks, marketHours);

  const mockDeps: EventListenerDeps = { repository, lifecycleService };
  const harness = createTestHarness({ serviceName: 'execution-ctrl', handlers: createHandlers(mockDeps) });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ Items: [] });
    process.env = { ...ORIGINAL_ENV, TABLE_NAME: 'test-table' };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should process DECISION_APPROVED event', async () => {
    const record = fakeSqsRecord('DECISION_APPROVED', {
      tenantId: 't1',
      decisionPacketId: 'dp-1',
      proposedTrades: [
        { symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 10, targetWeightPercent: 50, rationale: 'Buy' },
      ],
    }, { eventId: 'evt-1', tenantId: 't1' });

    const result = await harness.process([record]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.metrics.EventProcessed).toBe(1);
  });

  it('should process USER_CONFIRMED event', async () => {
    const record = fakeSqsRecord('USER_CONFIRMED', {
      tenantId: 't1',
      decisionPacketId: 'dp-2',
      proposedTrades: [],
    }, { eventId: 'evt-2', tenantId: 't1' });

    const result = await harness.process([record]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.metrics.EventProcessed).toBe(1);
  });

  it('should skip unknown event types gracefully', async () => {
    const record = fakeSqsRecord('UNKNOWN_EVENT', {}, { eventId: 'evt-3', tenantId: 't1' });

    const result = await harness.process([record]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it('should report batch item failures for processing errors', async () => {
    // Make lifecycleService throw
    jest.spyOn(lifecycleService, 'processApprovedDecision').mockRejectedValueOnce(new Error('Parse error'));

    const record = fakeSqsRecord('DECISION_APPROVED', {}, { eventId: 'evt-fail', tenantId: 't1' });

    const result = await harness.process([record]);
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  it('should skip duplicate events when createOrder returns false', async () => {
    jest.spyOn(repository, 'createOrder').mockResolvedValueOnce(false);

    const record = fakeSqsRecord('DECISION_APPROVED', {
      tenantId: 't1',
      decisionPacketId: 'dp-dup',
      proposedTrades: [],
    }, { eventId: 'evt-dup', tenantId: 't1' });

    const result = await harness.process([record]);
    expect(result.batchItemFailures).toHaveLength(0);
    // Safety checks should NOT have been called (early return on duplicate)
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should handle CIRCUIT_BREAKER_TRIGGERED event', async () => {
    const record = fakeSqsRecord('CIRCUIT_BREAKER_TRIGGERED', {}, { eventId: 'evt-cb', tenantId: 't1' });

    const result = await harness.process([record]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.metrics.EventProcessed).toBe(1);
  });

  it('should handle CIRCUIT_BREAKER_RESET event', async () => {
    const record = fakeSqsRecord('CIRCUIT_BREAKER_RESET', {}, { eventId: 'evt-cbr', tenantId: 't1' });

    const result = await harness.process([record]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.metrics.EventProcessed).toBe(1);
  });
});
