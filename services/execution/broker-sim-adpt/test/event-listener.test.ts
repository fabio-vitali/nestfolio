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

const mockEventListenerQuotePrices: Record<string, number> = {
  VTI: 250.50, VXUS: 58.75, BND: 72.30, VNQ: 85.40, GLD: 195.80,
  SPY: 520.15, QQQ: 445.60, IWM: 210.25, EFA: 78.90, EEM: 42.15,
  TLT: 92.50, AGG: 98.75, VIG: 178.30, SCHD: 82.45, VOO: 480.20,
  VGSH: 58.10, VCIT: 80.55, VWO: 43.20, IEMG: 52.80, XLF: 42.90,
};

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
  NotRetryableError: class NotRetryableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotRetryableError';
    }
  },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  StaticMarketDataProvider: jest.fn().mockImplementation(() => ({})),
  CachedMarketDataProvider: jest.fn().mockImplementation(() => ({
    getQuote: jest.fn().mockImplementation(async (symbol: string) => {
      const price = mockEventListenerQuotePrices[symbol];
      if (!price) return null;
      return { symbol, price, change: 0, changePercent: 0, volume: 1000, timestamp: '2026-01-01' };
    }),
  })),
  KNOWN_SYMBOLS: Object.keys(mockEventListenerQuotePrices),

  requireEnv: (name: string) => process.env[name] ?? name,
  NotRetryableError: class NotRetryableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotRetryableError';
    }
  },
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
  guardedWrite: (...args: unknown[]) => mockGuardedWrite(...args),

}));
const mockGuardedWrite = jest.fn().mockResolvedValue(true);

import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../src/handlers/event-listener';
import { VirtualLedgerRepository } from '../src/repositories/virtual-ledger.repository';
import { MarketDataService } from '../src/services/market-data.service';
import { SimulationEngineService } from '../src/services/simulation-engine.service';

describe('event-listener handler', () => {
  const ORIGINAL_ENV = process.env;

  const repository = new VirtualLedgerRepository('test-table');
  const marketData = new MarketDataService();
  const simulationEngine = new SimulationEngineService(repository, marketData);

  const mockDeps: EventListenerDeps = { repository, simulationEngine };
  const harness = createTestHarness({ serviceName: 'broker-sim-adpt', handlers: createHandlers(mockDeps) });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, TABLE_NAME: 'test-table' };
    mockGuardedWrite.mockResolvedValue(true);
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should process ORDER_SUBMITTED and fill a valid BUY order', async () => {
    // getCashBalance (lazy init check) -> found
    mockSend.mockResolvedValueOnce({ Item: { balance: 100000 } });
    // getCashBalance (simulation engine) -> found
    mockSend.mockResolvedValueOnce({ Item: { balance: 100000 } });
    // getPosition -> not found
    mockSend.mockResolvedValueOnce({ Item: undefined });
    // getPosition (inside executeTrade) -> not found
    mockSend.mockResolvedValueOnce({ Item: undefined });
    // transactWrite (executeTrade) -> success
    mockSend.mockResolvedValueOnce({});

    const record = fakeSqsRecord('ORDER_SUBMITTED', {
      orderId: 'order-1',
      tenantId: 't-1',
      userId: 'u-1',
      symbol: 'VTI',
      side: 'BUY',
      quantity: 10,
    }, { eventId: 'evt-1', tenantId: 't-1' });

    const result = await harness.process([record]);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should process WITHDRAWAL_REQUESTED and complete a valid withdrawal', async () => {
    // getCashBalance (balance check) -> found
    mockSend.mockResolvedValueOnce({ Item: { balance: 100000 } });

    const record = fakeSqsRecord('WITHDRAWAL_REQUESTED', {
      withdrawalId: 'w-1',
      tenantId: 't-1',
      userId: 'u-1',
      amount: 5000,
    }, { eventId: 'evt-2', tenantId: 't-1' });

    const result = await harness.process([record]);
    expect(result.batchItemFailures).toHaveLength(0);

    // guardedWrite should have been called with negative amount
    expect(mockGuardedWrite).toHaveBeenCalledWith(
      expect.anything(),
      'test-table',
      { pk: 'VirtualLedger#t-1#u-1', sk: 'ProcessedEvent#evt-2' },
      expect.arrayContaining([
        expect.objectContaining({
          Update: expect.objectContaining({
            ExpressionAttributeValues: expect.objectContaining({ ':amount': -5000 }),
          }),
        }),
      ]),
      604800,
    );
  });

  it('should report failure when ORDER_SUBMITTED is missing required fields', async () => {
    const record = fakeSqsRecord('ORDER_SUBMITTED', {
      tenantId: 't-1',
      userId: 'u-1',
      // Missing: orderId, symbol, side, quantity
    }, { eventId: 'evt-missing-fields', tenantId: 't-1' });

    const result = await harness.process([record]);
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error.message).toContain('Missing required ORDER_SUBMITTED fields');
  });

  it('should skip unknown event types gracefully', async () => {
    const record = fakeSqsRecord('UNKNOWN_EVENT', {}, { eventId: 'evt-3', tenantId: 't-1' });

    const result = await harness.process([record]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it('should report batch item failures for processing errors', async () => {
    // getCashBalance throws
    mockSend.mockRejectedValueOnce(new Error('DDB error'));

    const record = fakeSqsRecord('ORDER_SUBMITTED', {
      orderId: 'order-fail',
      tenantId: 't-1',
      userId: 'u-1',
      symbol: 'VTI',
      side: 'BUY',
      quantity: 10,
    }, { eventId: 'evt-fail', tenantId: 't-1' });

    const result = await harness.process([record]);
    expect(result.batchItemFailures).toHaveLength(1);
  });

  it('should skip duplicate ORDER_SUBMITTED event (TransactionCanceledException)', async () => {
    // getCashBalance (lazy init check) -> found
    mockSend.mockResolvedValueOnce({ Item: { balance: 100000 } });
    // getCashBalance (simulation engine) -> found
    mockSend.mockResolvedValueOnce({ Item: { balance: 100000 } });
    // getPosition -> not found
    mockSend.mockResolvedValueOnce({ Item: undefined });
    // getPosition (inside executeTrade) -> not found
    mockSend.mockResolvedValueOnce({ Item: undefined });
    // transactWrite -> duplicate (TransactionCanceledException)
    const txError = new Error('Transaction cancelled');
    txError.name = 'TransactionCanceledException';
    mockSend.mockRejectedValueOnce(txError);

    const record = fakeSqsRecord('ORDER_SUBMITTED', {
      orderId: 'order-dup',
      tenantId: 't-1',
      userId: 'u-1',
      symbol: 'VTI',
      side: 'BUY',
      quantity: 10,
    }, { eventId: 'evt-dup-order', tenantId: 't-1' });

    const result = await harness.process([record]);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should skip duplicate WITHDRAWAL_REQUESTED event (guardedAddToCashBalance returns false)', async () => {
    // getCashBalance -> found (balance check)
    mockSend.mockResolvedValueOnce({ Item: { balance: 100000 } });
    // guardedAddToCashBalance -> duplicate
    mockGuardedWrite.mockResolvedValueOnce(false);

    const record = fakeSqsRecord('WITHDRAWAL_REQUESTED', {
      withdrawalId: 'w-dup',
      tenantId: 't-1',
      userId: 'u-1',
      amount: 5000,
    }, { eventId: 'evt-dup-withdraw', tenantId: 't-1' });

    const result = await harness.process([record]);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should skip duplicate DEPOSIT_INITIATED event (guardedAddToCashBalance returns false)', async () => {
    // getCashBalance (lazy init check) -> found
    mockSend.mockResolvedValueOnce({ Item: { balance: 50000 } });
    // guardedAddToCashBalance -> duplicate
    mockGuardedWrite.mockResolvedValueOnce(false);

    const record = fakeSqsRecord('DEPOSIT_INITIATED', {
      depositId: 'dep-dup',
      tenantId: 't-1',
      userId: 'u-1',
      amountCents: 10000,
      currency: 'USD',
    }, { eventId: 'evt-dup-deposit', tenantId: 't-1' });

    const result = await harness.process([record]);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should throw descriptive error when ORDER_SUBMITTED has null subject', async () => {
    const record = fakeSqsRecord('ORDER_SUBMITTED', null as any, { eventId: 'evt-null-subject', tenantId: 't-1' });

    const result = await harness.process([record]);
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.errors[0].error.message).toContain('Missing subject in ORDER_SUBMITTED event');
  });

  it('should throw descriptive error when WITHDRAWAL_REQUESTED has null subject', async () => {
    const record = fakeSqsRecord('WITHDRAWAL_REQUESTED', null as any, { eventId: 'evt-null-subject-w', tenantId: 't-1' });

    const result = await harness.process([record]);
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.errors[0].error.message).toContain('Missing subject in WITHDRAWAL_REQUESTED event');
  });

  it('should process DEPOSIT_INITIATED using guardedAddToCashBalance', async () => {
    // getCashBalance (lazy init check) -> found
    mockSend.mockResolvedValueOnce({ Item: { balance: 50000 } });

    const record = fakeSqsRecord('DEPOSIT_INITIATED', {
      depositId: 'dep-1',
      tenantId: 't-1',
      userId: 'u-1',
      amountCents: 10000,
      currency: 'USD',
    }, { eventId: 'evt-deposit', tenantId: 't-1' });

    const result = await harness.process([record]);
    expect(result.batchItemFailures).toHaveLength(0);

    // guardedWrite should have been called for the deposit
    expect(mockGuardedWrite).toHaveBeenCalledWith(
      expect.anything(),
      'test-table',
      { pk: 'VirtualLedger#t-1#u-1', sk: 'ProcessedEvent#evt-deposit' },
      expect.arrayContaining([
        expect.objectContaining({
          Update: expect.objectContaining({
            UpdateExpression: 'ADD balance :amount SET #ts = :ts, updatedAt = :now',
          }),
        }),
      ]),
      604800,
    );
  });

  it('should return record(DepositDetected) intent after processing DEPOSIT_INITIATED', async () => {
    // getCashBalance (lazy init check) -> found
    mockSend.mockResolvedValueOnce({ Item: { balance: 50000 } });

    const sqsRecord = fakeSqsRecord('DEPOSIT_INITIATED', {
      depositId: 'dep-2',
      tenantId: 't-1',
      userId: 'u-1',
      amountCents: 20000,
      currency: 'USD',
    }, { eventId: 'evt-deposit-record', tenantId: 't-1' });

    const result = await harness.process([sqsRecord]);
    expect(result.batchItemFailures).toHaveLength(0);

    const intent = result.intents.find((i) => i._tag === 'record');
    expect(intent).toBeDefined();
    expect(intent).toMatchObject({
      _tag: 'record',
      typename: 'DepositDetected',
      fields: expect.objectContaining({
        __typename: 'DepositDetected',
        depositId: 'dep-2',
        amountCents: 20000,
        currency: 'USD',
        tenantId: 't-1',
        userId: 'u-1',
        sourceEventId: 'evt-deposit-record',
      }),
    });
  });

  it('should return record(DepositDetected) intent even for duplicate deposit (idempotent)', async () => {
    // getCashBalance (lazy init check) -> found
    mockSend.mockResolvedValueOnce({ Item: { balance: 50000 } });
    // guardedAddToCashBalance -> duplicate
    mockGuardedWrite.mockResolvedValueOnce(false);

    const sqsRecord = fakeSqsRecord('DEPOSIT_INITIATED', {
      depositId: 'dep-dup2',
      tenantId: 't-1',
      userId: 'u-1',
      amountCents: 10000,
      currency: 'USD',
    }, { eventId: 'evt-dup-deposit2', tenantId: 't-1' });

    const result = await harness.process([sqsRecord]);
    expect(result.batchItemFailures).toHaveLength(0);

    const intent = result.intents.find((i) => i._tag === 'record');
    expect(intent).toBeDefined();
    expect(intent).toMatchObject({
      _tag: 'record',
      typename: 'DepositDetected',
      fields: expect.objectContaining({
        __typename: 'DepositDetected',
        depositId: 'dep-dup2',
      }),
    });
  });

  describe('WITHDRAWAL_REQUESTED handler', () => {
    it('should return WithdrawalCompleted record after processing', async () => {
      // getCashBalance (balance check) -> found with sufficient balance
      mockSend.mockResolvedValueOnce({ Item: { balance: 100000 } });

      const sqsRecord = fakeSqsRecord('WITHDRAWAL_REQUESTED', {
        withdrawalId: 'wth-1',
        amount: 50,
        userId: 'user-1',
      }, { eventId: 'evt-withdrawal-record', tenantId: 'tenant-1' });

      const result = await harness.process([sqsRecord]);

      expect(result.skipped).toBe(0);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(result.intents[0]).toMatchObject({
        _tag: 'record',
        typename: 'WithdrawalCompleted',
        fields: expect.objectContaining({
          __typename: 'WithdrawalCompleted',
          withdrawalId: 'wth-1',
          tenantId: 'tenant-1',
          amount: 50,
          userId: 'user-1',
          sourceEventId: 'evt-withdrawal-record',
        }),
      });
    });

    it('should emit no record intent when balance is insufficient', async () => {
      // getCashBalance (balance check) -> found with low balance
      mockSend.mockResolvedValueOnce({ Item: { balance: 10 } });

      const sqsRecord = fakeSqsRecord('WITHDRAWAL_REQUESTED', {
        withdrawalId: 'wth-2',
        amount: 99999,
        userId: 'user-1',
      }, { eventId: 'evt-withdrawal-insufficient', tenantId: 'tenant-1' });

      const result = await harness.process([sqsRecord]);
      // Handler returns skip() — no record intent emitted, no failure
      expect(result.batchItemFailures).toHaveLength(0);
      expect(result.intents.filter((i) => i._tag === 'record')).toHaveLength(0);
    });

    it('should return WithdrawalCompleted record even for duplicate (idempotent — guardedAddToCashBalance returns false)', async () => {
      // getCashBalance (balance check) -> found
      mockSend.mockResolvedValueOnce({ Item: { balance: 100000 } });
      // guardedAddToCashBalance -> duplicate
      mockGuardedWrite.mockResolvedValueOnce(false);

      const sqsRecord = fakeSqsRecord('WITHDRAWAL_REQUESTED', {
        withdrawalId: 'wth-dup',
        amount: 100,
        userId: 'user-1',
      }, { eventId: 'evt-withdrawal-dup', tenantId: 'tenant-1' });

      const result = await harness.process([sqsRecord]);
      expect(result.batchItemFailures).toHaveLength(0);

      const intent = result.intents.find((i) => i._tag === 'record');
      expect(intent).toBeDefined();
      expect(intent).toMatchObject({
        _tag: 'record',
        typename: 'WithdrawalCompleted',
        fields: expect.objectContaining({
          __typename: 'WithdrawalCompleted',
          withdrawalId: 'wth-dup',
        }),
      });
    });
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

    const record = fakeSqsRecord('ORDER_SUBMITTED', {
      orderId: 'order-init',
      tenantId: 't-1',
      userId: 'u-1',
      symbol: 'VTI',
      side: 'BUY',
      quantity: 2,
    }, { eventId: 'evt-init', tenantId: 't-1' });

    const result = await harness.process([record]);
    expect(result.batchItemFailures).toHaveLength(0);

    // Should have called initializeCashBalance (the PutCommand for cash init)
    const secondCall = mockSend.mock.calls[1][0];
    expect(secondCall.input.Item).toMatchObject({
      __typename: 'VirtualCashBalance',
      balance: 100000,
    });
  });
});
