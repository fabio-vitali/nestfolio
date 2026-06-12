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
import { createHandlers, type EventListenerDeps } from '../../src/handlers/event-listener';
import { OrderRepository } from '../../src/repositories/order.repository';
import { SafetyChecksService } from '../../src/services/safety-checks.service';
import { MarketHoursService } from '../../src/services/market-hours.service';

// Valid ComplianceCheck subject fixture (matches ComplianceCheckSchema exactly).
// proposedTrades ride RECOMMENDATION_PROPOSED, not this event — the order is created with [].
function complianceCheckSubject(decisionPacketId: string): Record<string, unknown> {
  return {
    ccId: 'cc-test',
    decisionPacketId,
    decisionId: decisionPacketId,
    taskToken: 'tok',
    mandateSnapshot: {
      level: 'DISCRETIONARY',
      status: 'ACTIVE',
      operatingMode: 'BALANCED',
      effectiveDate: '2025-01-01',
    },
    status: 'COMPLETED',
    result: 'APPROVED',
    violations: [],
    authorityLevel: 'L1',
    sourceEventId: 'src-evt',
  };
}

// Valid UserConfirmation subject fixture (matches UserConfirmationSchema exactly).
function userConfirmationSubject(decisionId: string): Record<string, unknown> {
  return {
    decisionId,
    confirmedAt: '2025-01-01T00:00:00.000Z',
    confirmedBy: 'user-1',
    timestamp: '2025-01-01T00:00:00.000Z',
  };
}

describe('event-listener handler', () => {
  const ORIGINAL_ENV = process.env;

  const repository = new OrderRepository('test-table');
  const safetyChecks = new SafetyChecksService(repository);
  const marketHours = new MarketHoursService();

  const mockDeps: EventListenerDeps = { safetyChecks, marketHours };
  const harness = createTestHarness({ serviceName: 'execution-ctrl', handlers: createHandlers(mockDeps) });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ Items: [] });
    process.env = { ...ORIGINAL_ENV, TABLE_NAME: 'test-table' };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  // --- WriteIntent tests ---

  it('DECISION_APPROVED + safety passing + market open → returns record(Order) with status SUBMITTED', async () => {
    jest.spyOn(safetyChecks, 'runAllChecks').mockResolvedValueOnce({
      passed: true,
      checks: { reconciliationLock: false, conflictingStagedOrders: false, coolDown: false },
    });
    jest.spyOn(marketHours, 'isMarketOpen').mockResolvedValueOnce(true);

    const sqsRecord = fakeSqsRecord('DECISION_APPROVED', complianceCheckSubject('dp-1'), { eventId: 'evt-1', tenantId: 't1' });

    const result = await harness.process([sqsRecord]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({ _tag: 'record', typename: 'Order', fields: expect.objectContaining({ status: 'SUBMITTED' }) });
  });

  it('DECISION_APPROVED + safety failing → returns record(Order) with status REJECTED', async () => {
    jest.spyOn(safetyChecks, 'runAllChecks').mockResolvedValueOnce({
      passed: false,
      reason: 'Cool down period active',
      checks: { reconciliationLock: false, conflictingStagedOrders: false, coolDown: true },
    });

    const sqsRecord = fakeSqsRecord('DECISION_APPROVED', complianceCheckSubject('dp-2'), { eventId: 'evt-2', tenantId: 't1' });

    const result = await harness.process([sqsRecord]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({ _tag: 'record', typename: 'Order', fields: expect.objectContaining({ status: 'REJECTED', reason: 'Cool down period active' }) });
  });

  it('DECISION_APPROVED + market closed → returns record(Order, STAGED) + record(StagedOrder)', async () => {
    jest.spyOn(safetyChecks, 'runAllChecks').mockResolvedValueOnce({
      passed: true,
      checks: { reconciliationLock: false, conflictingStagedOrders: false, coolDown: false },
    });
    jest.spyOn(marketHours, 'isMarketOpen').mockResolvedValueOnce(false);

    const sqsRecord = fakeSqsRecord('DECISION_APPROVED', complianceCheckSubject('dp-3'), { eventId: 'evt-3', tenantId: 't1' });

    const result = await harness.process([sqsRecord]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.intents).toHaveLength(2);
    expect(result.intents[0]).toMatchObject({ _tag: 'record', typename: 'Order', fields: expect.objectContaining({ status: 'STAGED' }) });
    expect(result.intents[1]).toMatchObject({ _tag: 'record', typename: 'StagedOrder', fields: expect.objectContaining({ orderId: 'evt-3', tenantId: 't1' }) });
  });

  it('USER_CONFIRMED + safety passing + market open → returns record(Order) with status SUBMITTED', async () => {
    jest.spyOn(safetyChecks, 'runAllChecks').mockResolvedValueOnce({
      passed: true,
      checks: { reconciliationLock: false, conflictingStagedOrders: false, coolDown: false },
    });
    jest.spyOn(marketHours, 'isMarketOpen').mockResolvedValueOnce(true);

    const sqsRecord = fakeSqsRecord('USER_CONFIRMED', userConfirmationSubject('dec-id-4'), { eventId: 'evt-4', tenantId: 't1' });

    const result = await harness.process([sqsRecord]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({ _tag: 'record', typename: 'Order', fields: expect.objectContaining({ status: 'SUBMITTED' }) });
  });

  it('ACCOUNT_CLOSURE_REQUESTED → returns skip()', async () => {
    const sqsRecord = fakeSqsRecord('ACCOUNT_CLOSURE_REQUESTED', {}, { eventId: 'evt-ac', tenantId: 't1' });

    const result = await harness.process([sqsRecord]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({ _tag: 'skip' });
  });

  it('USER_CONFIRMED uses subject.decisionId as the packet id (no decisionPacketId on the event)', async () => {
    jest.spyOn(safetyChecks, 'runAllChecks').mockResolvedValueOnce({
      passed: true,
      checks: { reconciliationLock: false, conflictingStagedOrders: false, coolDown: false },
    });
    jest.spyOn(marketHours, 'isMarketOpen').mockResolvedValueOnce(true);

    const sqsRecord = fakeSqsRecord('USER_CONFIRMED', {
      decisionId: 'dec-123',
      confirmedAt: 't',
      confirmedBy: 'u',
      timestamp: 't',
    }, { eventId: 'ord-1', tenantId: 'T' });

    const result = await harness.process([sqsRecord]);
    expect(result.batchItemFailures).toHaveLength(0);
    const intent = result.intents[0];
    const order = (Array.isArray(intent) ? intent[0] : intent);
    expect(order.fields.decisionPacketId).toBe('dec-123');
  });

  it('should skip unknown event types gracefully', async () => {
    const sqsRecord = fakeSqsRecord('UNKNOWN_EVENT', {}, { eventId: 'evt-unk', tenantId: 't1' });

    const result = await harness.process([sqsRecord]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it('should report batch item failures for processing errors', async () => {
    jest.spyOn(safetyChecks, 'runAllChecks').mockRejectedValueOnce(new Error('Safety check error'));

    const sqsRecord = fakeSqsRecord('DECISION_APPROVED', complianceCheckSubject('dp-fail'), { eventId: 'evt-fail', tenantId: 't1' });

    const result = await harness.process([sqsRecord]);
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  it('Order record pk/sk matches repository layout', async () => {
    jest.spyOn(safetyChecks, 'runAllChecks').mockResolvedValueOnce({
      passed: true,
      checks: { reconciliationLock: false, conflictingStagedOrders: false, coolDown: false },
    });
    jest.spyOn(marketHours, 'isMarketOpen').mockResolvedValueOnce(true);

    const sqsRecord = fakeSqsRecord('DECISION_APPROVED', complianceCheckSubject('dp-pk'), { eventId: 'order-id-99', tenantId: 'tenant-x' });

    const result = await harness.process([sqsRecord]);
    expect(result.intents[0]).toMatchObject({
      _tag: 'record',
      typename: 'Order',
      overrides: { pk: 'Order#tenant-x#order-id-99', sk: 'Order' },
    });
  });
});
