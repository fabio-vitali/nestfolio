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
    QueryCommand: jest.fn().mockImplementation((input) => ({ _type: 'Query', input })),
    UpdateCommand: jest.fn().mockImplementation((input) => ({ _type: 'Update', input })),
  };
});

const mockQuotePrices: Record<string, number> = {
  VTI: 250.50, VXUS: 58.75, BND: 72.30, VNQ: 85.40, GLD: 195.80,
  SPY: 520.15, QQQ: 445.60, IWM: 210.25, EFA: 78.90, EEM: 42.15,
  TLT: 92.50, AGG: 98.75, VIG: 178.30, SCHD: 82.45, VOO: 480.20,
  VGSH: 58.10, VCIT: 80.55, VWO: 43.20, IEMG: 52.80, XLF: 42.90,
};

jest.mock('@nestfolio/event-processor', () => {
  const ddb = jest.requireMock('@aws-sdk/lib-dynamodb') as {
    PutCommand: jest.Mock; QueryCommand: jest.Mock;
  };
  return {
  ...jest.requireActual('@nestfolio/event-processor'),
  TableRepository: class {
    protected readonly docClient: { send: jest.Mock };
    protected readonly tableName: string;
    constructor(tableName: string) {
      this.tableName = tableName;
      this.docClient = { send: mockSend };
    }
    protected async put(item: Record<string, unknown>) {
      await this.docClient.send(new ddb.PutCommand({ TableName: this.tableName, Item: item }));
    }
    protected async putIfNotExists(item: Record<string, unknown>): Promise<boolean> {
      try {
        await this.docClient.send(new ddb.PutCommand({ TableName: this.tableName, Item: item, ConditionExpression: 'attribute_not_exists(pk)' }));
        return true;
      } catch (error: unknown) {
        if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return false;
        throw error;
      }
    }
    protected async queryByPk(pk: string, skPrefix?: string) {
      const result = await this.docClient.send(new ddb.QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: skPrefix ? 'pk = :pk AND begins_with(sk, :sk)' : 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk, ...(skPrefix ? { ':sk': skPrefix } : {}) },
      }));
      return result.Items ?? [];
    }
    protected async queryAll(input: unknown) {
      const result = await this.docClient.send(new ddb.QueryCommand(input));
      return result.Items ?? [];
    }
  },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  StaticMarketDataProvider: jest.fn().mockImplementation(() => ({})),
  CachedMarketDataProvider: jest.fn().mockImplementation(() => ({
    getQuote: jest.fn().mockImplementation(async (symbol: string) => {
      const price = mockQuotePrices[symbol];
      if (!price) return null;
      return { symbol, price, change: 0, changePercent: 0, volume: 1000, timestamp: '2026-01-01' };
    }),
  })),

  requireEnv: (name: string) => process.env[name] ?? name,
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),

  };
});
process.env.TABLE_NAME = 'test-table';

import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../../src/handlers/event-listener';
import { LedgerRepository } from '../../src/repositories/ledger.repository';
import { ShadowFillService } from '../../src/services/shadow-fill.service';
import { TaxLotManager } from '../../src/services/tax-lot-manager';

describe('ledger-ctrl event-listener handler', () => {
  const repository = new LedgerRepository('test-table');
  const shadowFill = new ShadowFillService();
  const taxLotManager = new TaxLotManager(repository);

  // Spy on TaxLotManager methods
  const openLotSpy = jest.spyOn(taxLotManager, 'openLot' as any).mockResolvedValue(undefined) as unknown as jest.SpyInstance;
  const closeLotsSpy = jest.spyOn(taxLotManager, 'closeLots' as any).mockResolvedValue([]) as unknown as jest.SpyInstance;

  const mockDeps: EventListenerDeps = {
    repository,
    shadowFill,
    taxLotManager,
  };

  const harness = createTestHarness({
    serviceName: 'ledger-ctrl',
    handlers: createHandlers(mockDeps),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ Items: [], Attributes: { lastSequence: 1 } });
  });

  it('should process DEPOSIT_DETECTED as actual event', async () => {
    const result = await harness.process([
      fakeSqsRecord('DEPOSIT_DETECTED', {
        tenantId: 't1', depositId: 'd1', amountCents: 500000, depositedAt: '2025-01-01T00:00:00.000Z',
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should process CORPORATE_ACTION_APPLIED event', async () => {
    const result = await harness.process([
      fakeSqsRecord('CORPORATE_ACTION_APPLIED', {
        tenantId: 't1', actionId: 'ca1', symbol: 'AAPL', actionType: 'STOCK_SPLIT',
        quantityMultiplier: 2, costBasisDivisor: 2, appliedAt: '2025-01-01T00:00:00.000Z',
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should process DECISION_PACKET_CREATED as simulation event', async () => {
    const result = await harness.process([
      fakeSqsRecord('DECISION_PACKET_CREATED', {
        tenantId: 't1',
        decisionPacketId: 'dp-1',
        proposedTrades: [
          { symbol: 'VTI', side: 'BUY', quantity: 10 },
          { symbol: 'SPY', side: 'BUY', quantity: 5 },
        ],
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should skip duplicate actual event when putLedgerEntry returns false', async () => {
    // First call: nextSequence (UpdateCommand), Second call: putIfNotExists (PutCommand) → ConditionalCheckFailedException
    mockSend
      .mockResolvedValueOnce({ Attributes: { lastSequence: 1 } }) // nextSequence
      .mockRejectedValueOnce(Object.assign(new Error('Conditional'), { name: 'ConditionalCheckFailedException' })); // putIfNotExists

    const result = await harness.process([
      fakeSqsRecord('ORDER_FILLED', {
        tenantId: 't1', orderId: 'order-dup',
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should skip duplicate simulation entries per trade', async () => {
    // For simulation: each trade calls nextSequence then putIfNotExists
    mockSend
      .mockResolvedValueOnce({ Attributes: { lastSequence: 1 } }) // nextSequence for trade 1
      .mockResolvedValueOnce({}) // putIfNotExists for trade 1 — success
      .mockResolvedValueOnce({ Attributes: { lastSequence: 2 } }) // nextSequence for trade 2
      .mockRejectedValueOnce(Object.assign(new Error('Conditional'), { name: 'ConditionalCheckFailedException' })); // putIfNotExists for trade 2 — duplicate

    const result = await harness.process([
      fakeSqsRecord('DECISION_PACKET_CREATED', {
        tenantId: 't1',
        decisionPacketId: 'dp-dup',
        proposedTrades: [
          { symbol: 'VTI', side: 'BUY', quantity: 10 },
          { symbol: 'SPY', side: 'BUY', quantity: 5 },
        ],
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should use deterministic simulation event IDs', async () => {
    mockSend.mockResolvedValue({ Items: [], Attributes: { lastSequence: 1 } });

    await harness.process([
      fakeSqsRecord('DECISION_PACKET_CREATED', {
        tenantId: 't1',
        decisionPacketId: 'dp-det',
        proposedTrades: [
          { symbol: 'VTI', side: 'BUY', quantity: 10 },
        ],
      }, { tenantId: 't1', eventId: 'evt-det-1' }),
    ]);

    // Check PutCommand was called with deterministic eventId
    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    const putCalls = PutCommand.mock.calls;
    const ledgerPut = putCalls.find(
      (c: Array<Record<string, unknown>>) => (c[0] as Record<string, Record<string, string>>)?.['Item']?.['sk'] === 'Event#evt-det-1-sim-VTI',
    );
    expect(ledgerPut).toBeDefined();
    const item = (ledgerPut as Array<Record<string, Record<string, string>>>)[0]['Item'];
    expect(item['eventId']).toBe('evt-det-1-sim-VTI');
    expect(item['sourceEventId']).toBe('evt-det-1-sim-VTI');
  });

  it('should skip unknown event types', async () => {
    const result = await harness.process([
      fakeSqsRecord('UNKNOWN_EVENT', {}, { tenantId: 't1' }),
    ]);
    expect(result.skipped).toBe(1);
  });

  it('should report retryable failures in batchItemFailures', async () => {
    // nextSequence throws
    mockSend.mockRejectedValueOnce(new Error('DDB error'));

    const result = await harness.process([
      fakeSqsRecord('ORDER_FILLED', {
        tenantId: 't1', orderId: 'o1',
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(1);
  });

  describe('TaxLotManager integration', () => {
    it('should call openLot for live BUY ORDER_FILLED', async () => {
      const result = await harness.process([
        fakeSqsRecord('ORDER_FILLED', {
          tenantId: 't1',
          orderId: 'ord-buy-1',
          symbol: 'VTI',
          side: 'BUY',
          filledQuantity: 50,
          averageFillPrice: 250.00,
          executionMode: 'live',
        }, { tenantId: 't1' }),
      ]);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(openLotSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't1',
          orderId: 'ord-buy-1',
          symbol: 'VTI',
          quantity: 50,
          costBasisPerShare: 250.00,
        }),
      );
    });

    it('should call closeLots for live SELL ORDER_FILLED', async () => {
      const result = await harness.process([
        fakeSqsRecord('ORDER_FILLED', {
          tenantId: 't1',
          orderId: 'ord-sell-1',
          symbol: 'VTI',
          side: 'SELL',
          filledQuantity: 30,
          averageFillPrice: 260.00,
          executionMode: 'live',
        }, { tenantId: 't1' }),
      ]);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(closeLotsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't1',
          symbol: 'VTI',
          quantity: 30,
          salePrice: 260.00,
          orderId: 'ord-sell-1',
        }),
      );
    });

    it('should NOT call TaxLotManager for simulation ORDER_FILLED', async () => {
      const result = await harness.process([
        fakeSqsRecord('ORDER_FILLED', {
          tenantId: 't1',
          orderId: 'ord-sim-1',
          symbol: 'VTI',
          side: 'BUY',
          filledQuantity: 50,
          averageFillPrice: 250.00,
          executionMode: 'simulation',
        }, { tenantId: 't1' }),
      ]);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(openLotSpy).not.toHaveBeenCalled();
      expect(closeLotsSpy).not.toHaveBeenCalled();
    });

    it('should NOT call TaxLotManager when executionMode is not present', async () => {
      const result = await harness.process([
        fakeSqsRecord('ORDER_FILLED', {
          tenantId: 't1',
          orderId: 'ord-no-mode',
          symbol: 'VTI',
          side: 'BUY',
          filledQuantity: 50,
          averageFillPrice: 250.00,
        }, { tenantId: 't1' }),
      ]);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(openLotSpy).not.toHaveBeenCalled();
      expect(closeLotsSpy).not.toHaveBeenCalled();
    });
  });
});
