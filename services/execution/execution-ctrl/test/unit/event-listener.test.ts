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

function trade(symbol: string, side: 'BUY' | 'SELL' = 'BUY', quantityOrAmountCents = 50000): Record<string, unknown> {
  return { symbol, assetClass: 'EQUITY', side, quantityOrAmountCents, targetWeightPercent: 50, rationale: 'r' };
}

function complianceCheckSubject(decisionPacketId: string, proposedTrades: Record<string, unknown>[]): Record<string, unknown> {
  return {
    ccId: 'cc-test',
    decisionPacketId,
    decisionId: decisionPacketId,
    taskToken: 'tok',
    mandateSnapshot: { level: 'DISCRETIONARY', status: 'ACTIVE', operatingMode: 'BALANCED', effectiveDate: '2025-01-01' },
    status: 'COMPLETED',
    result: 'APPROVED',
    violations: [],
    authorityLevel: 'L1',
    proposedTrades,
    sourceEventId: 'src-evt',
  };
}

function userConfirmationSubject(decisionId: string, proposedTrades: Record<string, unknown>[]): Record<string, unknown> {
  return {
    decisionId,
    confirmedAt: '2025-01-01T00:00:00.000Z',
    confirmedBy: 'user-1',
    timestamp: '2025-01-01T00:00:00.000Z',
    proposedTrades,
  };
}

const pass = { passed: true as const, checks: { reconciliationLock: false, conflictingStagedOrders: false } };

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

  it('DECISION_APPROVED with 2 trades + safety pass + market open → 2 SUBMITTED Order records, one per symbol', async () => {
    jest.spyOn(safetyChecks, 'runAllChecks').mockResolvedValue(pass);
    jest.spyOn(marketHours, 'isMarketOpen').mockResolvedValueOnce(true);

    const sqsRecord = fakeSqsRecord('DECISION_APPROVED', complianceCheckSubject('dp-1', [trade('VTI'), trade('BND', 'SELL', 30000)]), { eventId: 'evt-1', tenantId: 't1' });
    const result = await harness.process([sqsRecord]);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.intents).toHaveLength(2);
    const orders = result.intents.filter((i: any) => i.typename === 'Order');
    expect(orders).toHaveLength(2);
    expect(orders.map((o: any) => o.overrides.pk).sort()).toEqual(['Order#t1#evt-1#0', 'Order#t1#evt-1#1']);
    expect(orders.map((o: any) => o.fields.symbol).sort()).toEqual(['BND', 'VTI']);
    orders.forEach((o: any) => {
      expect(o.fields).toEqual(expect.objectContaining({ status: 'SUBMITTED', decisionPacketId: 'dp-1' }));
      expect(o.fields).not.toHaveProperty('proposedTrades');
    });
  });

  it('per-trade independence: one symbol fails safety → that order REJECTED, the other SUBMITTED', async () => {
    jest.spyOn(safetyChecks, 'runAllChecks').mockImplementation(async (_t: string, instruments: string[]) =>
      instruments.includes('BAD')
        ? { passed: false, reason: 'Conflicting staged orders exist for the same instruments', checks: { reconciliationLock: false, conflictingStagedOrders: true } }
        : pass,
    );
    jest.spyOn(marketHours, 'isMarketOpen').mockResolvedValueOnce(true);

    const sqsRecord = fakeSqsRecord('DECISION_APPROVED', complianceCheckSubject('dp-2', [trade('GOOD'), trade('BAD')]), { eventId: 'evt-2', tenantId: 't1' });
    const result = await harness.process([sqsRecord]);

    expect(result.batchItemFailures).toHaveLength(0);
    const bySymbol = Object.fromEntries(result.intents.map((i: any) => [i.fields.symbol, i.fields]));
    expect(bySymbol['GOOD'].status).toBe('SUBMITTED');
    expect(bySymbol['BAD']).toEqual(expect.objectContaining({ status: 'REJECTED', reason: 'Conflicting staged orders exist for the same instruments' }));
  });

  it('DECISION_APPROVED + market closed → per trade: STAGED Order + StagedOrder sibling', async () => {
    jest.spyOn(safetyChecks, 'runAllChecks').mockResolvedValue(pass);
    jest.spyOn(marketHours, 'isMarketOpen').mockResolvedValueOnce(false);

    const sqsRecord = fakeSqsRecord('DECISION_APPROVED', complianceCheckSubject('dp-3', [trade('VTI')]), { eventId: 'evt-3', tenantId: 't1' });
    const result = await harness.process([sqsRecord]);

    expect(result.intents).toHaveLength(2);
    const order = result.intents.find((i: any) => i.typename === 'Order');
    const staged = result.intents.find((i: any) => i.typename === 'StagedOrder');
    expect(order.fields).toEqual(expect.objectContaining({ status: 'STAGED', symbol: 'VTI' }));
    expect(staged.fields).toEqual(expect.objectContaining({ orderId: 'evt-3#0', symbol: 'VTI', tenantId: 't1' }));
    expect(staged.overrides.pk).toBe('StagedOrder#t1#evt-3#0');
  });

  it('USER_CONFIRMED with trades → SUBMITTED Order using subject.decisionId as decisionPacketId', async () => {
    jest.spyOn(safetyChecks, 'runAllChecks').mockResolvedValue(pass);
    jest.spyOn(marketHours, 'isMarketOpen').mockResolvedValueOnce(true);

    const sqsRecord = fakeSqsRecord('USER_CONFIRMED', userConfirmationSubject('dec-id-4', [trade('VTI')]), { eventId: 'evt-4', tenantId: 't1' });
    const result = await harness.process([sqsRecord]);

    expect(result.intents).toHaveLength(1);
    expect(result.intents[0].fields).toEqual(expect.objectContaining({ status: 'SUBMITTED', decisionPacketId: 'dec-id-4', symbol: 'VTI' }));
  });

  it('approved decision with zero trades → skip() (no Order rows)', async () => {
    const sqsRecord = fakeSqsRecord('DECISION_APPROVED', complianceCheckSubject('dp-empty', []), { eventId: 'evt-empty', tenantId: 't1' });
    const result = await harness.process([sqsRecord]);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({ _tag: 'skip' });
  });

  it('ACCOUNT_CLOSURE_REQUESTED → returns skip()', async () => {
    const sqsRecord = fakeSqsRecord('ACCOUNT_CLOSURE_REQUESTED', {}, { eventId: 'evt-ac', tenantId: 't1' });
    const result = await harness.process([sqsRecord]);
    expect(result.intents[0]).toMatchObject({ _tag: 'skip' });
  });

  it('should skip unknown event types gracefully', async () => {
    const sqsRecord = fakeSqsRecord('UNKNOWN_EVENT', {}, { eventId: 'evt-unk', tenantId: 't1' });
    const result = await harness.process([sqsRecord]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it('should report batch item failures for processing errors', async () => {
    jest.spyOn(safetyChecks, 'runAllChecks').mockRejectedValueOnce(new Error('Safety check error'));
    const sqsRecord = fakeSqsRecord('DECISION_APPROVED', complianceCheckSubject('dp-fail', [trade('VTI')]), { eventId: 'evt-fail', tenantId: 't1' });
    const result = await harness.process([sqsRecord]);
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });
});
