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
import { createHandlers, type EventListenerDeps } from '../../../src/handlers/event-listener';
import { LedgerRepository } from '../../../src/repositories/ledger.repository';
import { ShadowFillService } from '../../../src/services/shadow-fill.service';
import { TaxLotManager } from '../../../src/services/tax-lot-manager';

// ---------------------------------------------------------------------------
// Fixture helpers — real producer shapes (read from producer contracts, not invented)
// ---------------------------------------------------------------------------

/** Minimal valid NormalizedOrderEvent subject (matches NormalizedOrderEventSchema required fields). */
function makeOrderSubject(overrides: Partial<{
  orderId: string; executionMode: 'simulation' | 'live'; filledQty: number;
  averageFillPrice: number; failureReason: string; timestamp: string;
}> = {}) {
  return {
    orderId: 'order-1',
    executionMode: 'simulation' as const,
    timestamp: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Minimal valid DecisionPacketSchema subject (all required fields per producer contract). */
function makeDecisionPacketSubject(overrides: Partial<{
  decisionId: string;
  trigger: string;
  triggerEventId: string;
  executionArn: string | null;
  explanation: string;
  proposedTrades: unknown[];
  confirmationRequired: boolean;
  status: string;
  __version: number;
  complianceResult: string | null;
  authorityLevel: string | null;
  userDecision: string | null;
  blockReason: string | null;
  rejectionReason: string | null;
  timestamp: string;
  createdAt: string;
  updatedAt: string;
}> = {}) {
  return {
    decisionId: 'dp-1',
    trigger: 'MANDATE_SNAPSHOT_CREATED',
    triggerEventId: 'trigger-evt-1',
    executionArn: null,
    explanation: 'Rebalance portfolio',
    proposedTrades: [],
    confirmationRequired: false,
    status: 'PENDING',
    __version: 1,
    complianceResult: null,
    authorityLevel: null,
    userDecision: null,
    blockReason: null,
    rejectionReason: null,
    timestamp: '2025-01-01T00:00:00.000Z',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

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

  // -------------------------------------------------------------------------
  // Contract enforcement (ZodError / DLQ path)
  // -------------------------------------------------------------------------

  it('rejects an ORDER_FILLED subject missing required fields (contract enforcement)', async () => {
    // Pre-conversion: untyped read tolerates {}. Post-conversion: parseSubject throws ZodError.
    const result = await harness.process([
      fakeSqsRecord('ORDER_FILLED', {}, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(1);
  });

  it('rejects a DECISION_PACKET_CREATED subject missing required fields (contract enforcement)', async () => {
    // Post-conversion: parseSubject(DecisionPacketSchema) throws ZodError on minimal/invalid subject.
    // The old code read decisionPacketId (not in schema) and fell back to ctx.eventId; the schema now
    // requires decisionId + all other required fields.
    const result = await harness.process([
      fakeSqsRecord('DECISION_PACKET_CREATED', { decisionPacketId: 'dp-bad' }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // DEPOSIT_DETECTED — unknown/unhandled event (skipped)
  // -------------------------------------------------------------------------

  it('should skip DEPOSIT_DETECTED (not in handler map — pre-existing test naming gap)', async () => {
    // ledger-ctrl subscribes to DEPOSIT_SETTLED, not DEPOSIT_DETECTED; this event is skipped.
    const result = await harness.process([
      fakeSqsRecord('DEPOSIT_DETECTED', {
        tenantId: 't1', depositId: 'd1', amountCents: 500000, depositedAt: '2025-01-01T00:00:00.000Z',
      }, { tenantId: 't1' }),
    ]);
    expect(result.skipped).toBe(1);
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
      fakeSqsRecord('DECISION_PACKET_CREATED',
        makeDecisionPacketSubject({
          decisionId: 'dp-1',
          proposedTrades: [
            { symbol: 'VTI', side: 'BUY', quantityOrAmountCents: 1_000_000 },
            { symbol: 'SPY', side: 'BUY', quantityOrAmountCents: 500_000 },
          ],
        }),
        { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should skip duplicate actual event when putLedgerEntry returns false', async () => {
    // First call: nextSequence (UpdateCommand), Second call: putIfNotExists (PutCommand) → ConditionalCheckFailedException
    mockSend
      .mockResolvedValueOnce({ Attributes: { lastSequence: 1 } }) // nextSequence
      .mockRejectedValueOnce(Object.assign(new Error('Conditional'), { name: 'ConditionalCheckFailedException' })); // putIfNotExists

    const result = await harness.process([
      fakeSqsRecord('ORDER_FILLED', makeOrderSubject({ orderId: 'order-dup' }), { tenantId: 't1' }),
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
      fakeSqsRecord('DECISION_PACKET_CREATED',
        makeDecisionPacketSubject({
          decisionId: 'dp-dup',
          proposedTrades: [
            { symbol: 'VTI', side: 'BUY', quantityOrAmountCents: 1_000_000 },
            { symbol: 'SPY', side: 'BUY', quantityOrAmountCents: 500_000 },
          ],
        }),
        { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should use deterministic simulation event IDs and persist derived quantity + source amountCents', async () => {
    mockSend.mockResolvedValue({ Items: [], Attributes: { lastSequence: 1 } });

    await harness.process([
      fakeSqsRecord('DECISION_PACKET_CREATED',
        makeDecisionPacketSubject({
          decisionId: 'dp-det',
          proposedTrades: [
            // Unknown symbol → fallback price 100.0 → clean derivedQuantity math:
            // 100_000 cents / $100/share = 10 shares.
            { symbol: 'TEST-FAKE-SYM', side: 'BUY', quantityOrAmountCents: 100_000 },
          ],
        }),
        { tenantId: 't1', eventId: 'evt-det-1' }),
    ]);

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    const putCalls = PutCommand.mock.calls;
    const ledgerPut = putCalls.find(
      (c: Array<Record<string, unknown>>) => (c[0] as Record<string, Record<string, string>>)?.['Item']?.['sk'] === 'Event#evt-det-1-sim-TEST-FAKE-SYM',
    );
    expect(ledgerPut).toBeDefined();
    const item = (ledgerPut as Array<Record<string, Record<string, unknown>>>)[0]['Item'];
    expect(item['eventId']).toBe('evt-det-1-sim-TEST-FAKE-SYM');
    expect(item['sourceEventId']).toBe('evt-det-1-sim-TEST-FAKE-SYM');
    const payload = item['payload'] as Record<string, unknown>;
    expect(payload['quantity']).toBe(10);
    expect(payload['amountCents']).toBe(100_000);
    expect(payload['fillPrice']).toBe(100.0);
  });

  it('normalizes the actual ORDER_FILLED payload to the canonical RecordFill shape (WS-4 break D consumer)', async () => {
    mockSend.mockResolvedValue({ Items: [], Attributes: { lastSequence: 1 } });

    await harness.process([
      fakeSqsRecord('ORDER_FILLED', {
        orderId: 'order-norm', symbol: 'VTI', side: 'BUY',
        executionMode: 'simulation', filledQty: 2.5, averageFillPrice: 200,
        timestamp: '2025-01-01T00:00:00.000Z',
      }, { tenantId: 't1', eventId: 'evt-norm-1' }),
    ]);

    const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
    const ledgerPut = PutCommand.mock.calls.find(
      (c: Array<Record<string, Record<string, unknown>>>) =>
        ((c[0]?.['Item']?.['payload']) as Record<string, unknown> | undefined)?.['orderId'] === 'order-norm',
    );
    expect(ledgerPut).toBeDefined();
    const payload = (ledgerPut as Array<Record<string, Record<string, unknown>>>)[0]['Item']['payload'] as Record<string, unknown>;
    // canonical RecordFill names the reducer + shadow-fill path read
    expect(payload['quantity']).toBe(2.5);       // ← filledQty
    expect(payload['fillPrice']).toBe(200);      // ← averageFillPrice
    expect(typeof payload['filledAt']).toBe('string'); // ← ctx.timestamp
    expect(payload['symbol']).toBe('VTI');
    expect(payload['side']).toBe('BUY');
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
      fakeSqsRecord('ORDER_FILLED', makeOrderSubject({ orderId: 'o1' }), { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(1);
  });

  describe('TaxLotManager integration', () => {
    it('should call openLot for live BUY ORDER_FILLED', async () => {
      const result = await harness.process([
        fakeSqsRecord('ORDER_FILLED', {
          // NormalizedOrderEventSchema fields (required: orderId, executionMode, timestamp)
          orderId: 'ord-buy-1',
          executionMode: 'live',
          averageFillPrice: 250.00,
          filledQty: 50,
          timestamp: '2025-01-01T00:00:00.000Z',
          // boundary fields (not in schema, read via raw payload.subject in tax lot path):
          symbol: 'VTI',
          side: 'BUY',
        }, { tenantId: 't1' }),
      ]);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(openLotSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't1',
          orderId: 'ord-buy-1',
          symbol: 'VTI',
          // WS-4: tax-lot now reads the typed parsed subject — real quantity from filledQty.
          quantity: 50,
          costBasisPerShare: 250.00, // from subject.averageFillPrice
        }),
      );
    });

    it('should call closeLots for live SELL ORDER_FILLED', async () => {
      const result = await harness.process([
        fakeSqsRecord('ORDER_FILLED', {
          orderId: 'ord-sell-1',
          executionMode: 'live',
          averageFillPrice: 260.00,
          filledQty: 30,
          timestamp: '2025-01-01T00:00:00.000Z',
          // boundary fields:
          symbol: 'VTI',
          side: 'SELL',
        }, { tenantId: 't1' }),
      ]);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(closeLotsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't1',
          symbol: 'VTI',
          // WS-4: tax-lot now reads the typed parsed subject — real quantity from filledQty.
          quantity: 30,
          salePrice: 260.00, // from subject.averageFillPrice
          orderId: 'ord-sell-1',
        }),
      );
    });

    it('should NOT call TaxLotManager for simulation ORDER_FILLED', async () => {
      const result = await harness.process([
        fakeSqsRecord('ORDER_FILLED', {
          orderId: 'ord-sim-1',
          executionMode: 'simulation',
          filledQty: 50,
          averageFillPrice: 250.00,
          timestamp: '2025-01-01T00:00:00.000Z',
          // boundary fields:
          symbol: 'VTI',
          side: 'BUY',
        }, { tenantId: 't1' }),
      ]);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(openLotSpy).not.toHaveBeenCalled();
      expect(closeLotsSpy).not.toHaveBeenCalled();
    });

    it('should reject ORDER_FILLED missing required executionMode (ZodError → DLQ)', async () => {
      // executionMode is required by NormalizedOrderEventSchema — omitting it is a ZodError.
      // The old untyped code did not enforce this (tax lot path only checked the value).
      const result = await harness.process([
        fakeSqsRecord('ORDER_FILLED', {
          orderId: 'ord-no-mode',
          timestamp: '2025-01-01T00:00:00.000Z',
          // executionMode intentionally missing — now a ZodError
        }, { tenantId: 't1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(1);
    });
  });
});
