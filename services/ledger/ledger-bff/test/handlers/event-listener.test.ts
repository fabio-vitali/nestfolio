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
  },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },

  requireEnv: (name: string) => process.env[name] ?? name,
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),

}));
process.env.TABLE_NAME = 'test-table';

import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../../src/handlers/event-listener';
import { PortfolioRepository } from '../../src/repositories/portfolio.repository';
import { BalanceUpdatedPipe } from '../../src/pipes/balance-updated.pipe';
import { PortfolioUpdatedPipe } from '../../src/pipes/portfolio-updated.pipe';
import { LedgerEntryRecordedPipe } from '../../src/pipes/ledger-entry-recorded.pipe';

describe('ledger-bff event-listener handler', () => {
  const repository = new PortfolioRepository('test-table');
  const balanceUpdatedPipe = new BalanceUpdatedPipe(repository);
  const portfolioUpdatedPipe = new PortfolioUpdatedPipe(repository);
  const ledgerEntryRecordedPipe = new LedgerEntryRecordedPipe(repository);

  const mockDeps: EventListenerDeps = {
    eventPipeMap: {
      BALANCE_UPDATED: [{ name: 'balanceUpdated', pipe: balanceUpdatedPipe }],
      PORTFOLIO_UPDATED: [{ name: 'portfolioUpdated', pipe: portfolioUpdatedPipe }],
      LEDGER_ENTRY_RECORDED: [{ name: 'ledgerEntryRecorded', pipe: ledgerEntryRecordedPipe }],
    },
  };

  const harness = createTestHarness({
    serviceName: 'ledger-bff',
    handlers: createHandlers(mockDeps),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ Items: [] });
  });

  it('should process BALANCE_UPDATED event', async () => {
    const result = await harness.process([
      fakeSqsRecord('BALANCE_UPDATED', {
        cashBalanceCents: 950_000, deltaCents: -50_000,
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);

    const updateCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Update');
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0][0].input.Key.pk).toBe('Portfolio#t1');
  });

  it('should process PORTFOLIO_UPDATED event with positions', async () => {
    const result = await harness.process([
      fakeSqsRecord('PORTFOLIO_UPDATED', {
        positions: {
          VTI: { symbol: 'VTI', quantity: 10, averageCostBasis: 250, totalCostBasis: 2500, lastFillPrice: 251 },
        },
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);

    const putCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Put');
    expect(putCalls.length).toBe(1);
    expect(putCalls[0][0].input.Item.pk).toBe('Portfolio#t1');
    expect(putCalls[0][0].input.Item.sk).toBe('Position#VTI');
  });

  it('should process LEDGER_ENTRY_RECORDED event', async () => {
    const result = await harness.process([
      fakeSqsRecord('LEDGER_ENTRY_RECORDED', {
        eventId: 'entry-1',
        eventType: 'ORDER_FILLED',
        payload: { symbol: 'VTI', quantity: 10 },
        timestamp: '2025-01-01T00:00:00.000Z',
        sequenceNo: 1,
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);

    const putCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Put');
    expect(putCalls.length).toBe(1);
    expect(putCalls[0][0].input.Item.pk).toBe('History#t1');
  });

  it('should skip unknown event types gracefully', async () => {
    const result = await harness.process([
      fakeSqsRecord('UNKNOWN_EVENT', {}, { tenantId: 't1' }),
    ]);
    expect(result.skipped).toBe(1);
  });

  it('should report batch item failures for processing errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('DDB error'));

    const result = await harness.process([
      fakeSqsRecord('BALANCE_UPDATED', {
        cashBalanceCents: 950_000, deltaCents: -50_000,
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(1);
  });

  it('should handle simulated LEDGER_ENTRY_RECORDED with simulation upserts', async () => {
    const result = await harness.process([
      fakeSqsRecord('LEDGER_ENTRY_RECORDED', {
        eventId: 'entry-sim',
        eventType: 'ORDER_FILLED',
        payload: { symbol: 'SPY', quantity: 5 },
        timestamp: '2025-01-01T00:00:00.000Z',
        sequenceNo: 1,
        streamType: 'simulated',
        cashBalanceCents: 800_000,
        positions: {
          SPY: { symbol: 'SPY', quantity: 5, averageCostBasis: 520, totalCostBasis: 2600, lastFillPrice: 521 },
        },
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);

    const putCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Put');
    expect(putCalls.length).toBe(3);
    expect(putCalls[0][0].input.Item.pk).toBe('History#t1');
    expect(putCalls[1][0].input.Item.pk).toBe('Simulation#t1');
    expect(putCalls[1][0].input.Item.sk).toBe('Latest');
    expect(putCalls[2][0].input.Item.pk).toBe('Simulation#t1');
    expect(putCalls[2][0].input.Item.sk).toBe('Position#SPY');
  });
});
