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
    protected async putIfNotExists(item: Record<string, unknown>): Promise<boolean> {
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item }));
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
  withMethodLogging: jest.fn().mockImplementation(() =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../../src/handlers/event-listener';
import { ReconciliationService } from '../../src/services/reconciliation.service';
import { ReconciliationRepository } from '../../src/repositories/reconciliation.repository';

// ---------------------------------------------------------------------------
// Fixture helpers — real producer shapes (read from producer contracts)
// ---------------------------------------------------------------------------

/** Minimal valid PortfolioUpdatedSchema subject (includes required `snapshot` field). */
function makePortfolioUpdatedSubject(positions: Record<string, { symbol: string; quantity: number; averageCostBasis: number; totalCostBasis: number; lastFillPrice: number }> = {}) {
  return {
    positions,
    snapshot: {
      positions,
      cashBalanceCents: 0,
      lastEventSequence: 1,
    },
  };
}

process.env['TABLE_NAME'] = 'test-table';

describe('reconciliation-ctrl event-listener', () => {
  const reconciliationService = new ReconciliationService();
  const reconcileSpy = jest.spyOn(reconciliationService, 'reconcile');
  const repository = new ReconciliationRepository('test-table');
  const putSnapshotSpy = jest.spyOn(repository, 'putPositionSnapshot');
  const getSnapshotSpy = jest.spyOn(repository, 'getPositionSnapshot');

  const mockDeps: EventListenerDeps = {
    reconciliationService,
    repository,
    stalenessWindowMs: 24 * 60 * 60 * 1000,
  };

  const harness = createTestHarness({
    serviceName: 'reconciliation-ctrl',
    handlers: createHandlers(mockDeps),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  describe('contract enforcement', () => {
    it('rejects a PORTFOLIO_UPDATED subject missing required fields (contract enforcement)', async () => {
      // Pre-conversion: payload.subject?.positions returns undefined → normalizePositions([]) → skip.
      // Post-conversion: parseSubject(PortfolioUpdatedSchema) throws ZodError on missing positions/snapshot.
      const result = await harness.process([
        fakeSqsRecord('PORTFOLIO_UPDATED', {}, { tenantId: 't1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(1);
    });
  });

  describe('cache-and-compare — PORTFOLIO_UPDATED (intent side)', () => {
    it('should cache intent positions and skip when no settlement exists', async () => {
      getSnapshotSpy.mockResolvedValueOnce(null); // no settlement cached

      const result = await harness.process([
        fakeSqsRecord('PORTFOLIO_UPDATED',
          makePortfolioUpdatedSubject({ AAPL: { symbol: 'AAPL', quantity: 100, averageCostBasis: 150, totalCostBasis: 1500, lastFillPrice: 155 } }),
          { tenantId: 't1' }),
      ]);

      expect(putSnapshotSpy).toHaveBeenCalledWith('t1', 'Intent', [{ instrument: 'AAPL', quantity: 100 }], 'PORTFOLIO_UPDATED');
      expect(reconcileSpy).not.toHaveBeenCalled();
      const recordIntents = result.intents.filter((i: { _tag: string }) => i._tag === 'record');
      expect(recordIntents).toHaveLength(0);
    });

    it('should reconcile when fresh settlement exists', async () => {
      getSnapshotSpy.mockResolvedValueOnce({
        side: 'Settlement',
        positions: [{ instrument: 'AAPL', quantity: 90 }],
        capturedAt: new Date().toISOString(), // fresh
        sourceEventType: 'ALPACA_ACCOUNT_SNAPSHOT',
      });

      const result = await harness.process([
        fakeSqsRecord('PORTFOLIO_UPDATED',
          makePortfolioUpdatedSubject({ AAPL: { symbol: 'AAPL', quantity: 100, averageCostBasis: 150, totalCostBasis: 1500, lastFillPrice: 155 } }),
          { tenantId: 't1', eventId: 'evt-1' }),
      ]);

      // reconciliationId is a content hash, not ctx.eventId.
      expect(reconcileSpy).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{32}$/), expect.objectContaining({
        intentPositions: [{ instrument: 'AAPL', quantity: 100 }],
        settlementPositions: [{ instrument: 'AAPL', quantity: 90 }],
      }));
      expect(result.intents.length).toBeGreaterThanOrEqual(1);
      expect(result.intents[0]).toMatchObject({
        _tag: 'record',
        typename: 'ReconciliationResult',
        fields: expect.objectContaining({ status: 'DRIFT_DETECTED', driftCount: 1 }),
      });
    });

    it('should skip reconciliation when settlement is stale', async () => {
      getSnapshotSpy.mockResolvedValueOnce({
        side: 'Settlement',
        positions: [{ instrument: 'AAPL', quantity: 90 }],
        capturedAt: '2020-01-01T00:00:00.000Z', // stale
        sourceEventType: 'ALPACA_ACCOUNT_SNAPSHOT',
      });

      await harness.process([
        fakeSqsRecord('PORTFOLIO_UPDATED',
          makePortfolioUpdatedSubject({}),
          { tenantId: 't1' }),
      ]);

      expect(reconcileSpy).not.toHaveBeenCalled();
    });
  });

  describe('cache-and-compare — ALPACA_ACCOUNT_SNAPSHOT (settlement side)', () => {
    it('should cache settlement and reconcile when fresh intent exists', async () => {
      getSnapshotSpy.mockResolvedValueOnce({
        side: 'Intent',
        positions: [{ instrument: 'AAPL', quantity: 100 }],
        capturedAt: new Date().toISOString(),
        sourceEventType: 'PORTFOLIO_UPDATED',
      });

      const result = await harness.process([
        fakeSqsRecord('ALPACA_ACCOUNT_SNAPSHOT', {
          tenantId: 't1', portfolioId: 'p1',
          positions: [{ symbol: 'AAPL', qty: 95, marketValue: 14000 }],
        }, { tenantId: 't1', eventId: 'evt-2' }),
      ]);

      expect(putSnapshotSpy).toHaveBeenCalledWith('t1', 'Settlement', [{ instrument: 'AAPL', quantity: 95 }], 'ALPACA_ACCOUNT_SNAPSHOT');
      expect(reconcileSpy).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{32}$/), expect.objectContaining({
        intentPositions: [{ instrument: 'AAPL', quantity: 100 }],
        settlementPositions: [{ instrument: 'AAPL', quantity: 95 }],
      }));
      expect(result.intents.length).toBeGreaterThanOrEqual(1);
    });

    it('should cache settlement and skip when no intent exists', async () => {
      getSnapshotSpy.mockResolvedValueOnce(null);

      await harness.process([
        fakeSqsRecord('ALPACA_ACCOUNT_SNAPSHOT', {
          tenantId: 't1',
          positions: [{ symbol: 'AAPL', qty: 50, marketValue: 7500 }],
        }, { tenantId: 't1' }),
      ]);

      expect(putSnapshotSpy).toHaveBeenCalledWith('t1', 'Settlement', [{ instrument: 'AAPL', quantity: 50 }], 'ALPACA_ACCOUNT_SNAPSHOT');
      expect(reconcileSpy).not.toHaveBeenCalled();
    });
  });

  describe('drift detection', () => {
    it('should produce ReconciliationResult + DriftRecord when drift detected', async () => {
      getSnapshotSpy.mockResolvedValueOnce({
        side: 'Settlement',
        positions: [{ instrument: 'AAPL', quantity: 90 }, { instrument: 'TSLA', quantity: 55 }],
        capturedAt: new Date().toISOString(),
        sourceEventType: 'ALPACA_ACCOUNT_SNAPSHOT',
      });

      const result = await harness.process([
        fakeSqsRecord('PORTFOLIO_UPDATED',
          makePortfolioUpdatedSubject({
            AAPL: { symbol: 'AAPL', quantity: 100, averageCostBasis: 150, totalCostBasis: 1500, lastFillPrice: 155 },
            TSLA: { symbol: 'TSLA', quantity: 50, averageCostBasis: 200, totalCostBasis: 10000, lastFillPrice: 210 },
          }),
          { tenantId: 't1', eventId: 'evt-3' }),
      ]);

      expect(result.intents).toHaveLength(3); // 1 ReconciliationResult + 2 DriftRecords
      expect(result.intents[0]).toMatchObject({
        typename: 'ReconciliationResult',
        fields: expect.objectContaining({ status: 'DRIFT_DETECTED', driftCount: 2 }),
      });
      expect(result.intents[1]).toMatchObject({
        typename: 'DriftRecord',
        fields: expect.objectContaining({ instrument: 'AAPL', intentQty: 100, settlementQty: 90, drift: 10 }),
      });
      expect(result.intents[2]).toMatchObject({
        typename: 'DriftRecord',
        fields: expect.objectContaining({ instrument: 'TSLA', intentQty: 50, settlementQty: 55, drift: -5 }),
      });
    });

    it('should produce ReconciliationResult with COMPLETED when no drift', async () => {
      getSnapshotSpy.mockResolvedValueOnce({
        side: 'Settlement',
        positions: [{ instrument: 'VTI', quantity: 100 }],
        capturedAt: new Date().toISOString(),
        sourceEventType: 'ALPACA_ACCOUNT_SNAPSHOT',
      });

      const result = await harness.process([
        fakeSqsRecord('PORTFOLIO_UPDATED',
          makePortfolioUpdatedSubject({ VTI: { symbol: 'VTI', quantity: 100, averageCostBasis: 200, totalCostBasis: 20000, lastFillPrice: 245 } }),
          { tenantId: 't1', eventId: 'evt-4' }),
      ]);

      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toMatchObject({
        typename: 'ReconciliationResult',
        fields: expect.objectContaining({ status: 'COMPLETED', driftCount: 0 }),
      });
    });
  });

  describe('other event types', () => {
    it('should route PORTFOLIO_SNAPSHOT_IMPORTED as intent side', async () => {
      getSnapshotSpy.mockResolvedValueOnce(null);
      await harness.process([
        fakeSqsRecord('PORTFOLIO_SNAPSHOT_IMPORTED', {
          tenantId: 't1', positions: [{ symbol: 'AAPL', quantity: 100 }],
        }, { tenantId: 't1' }),
      ]);
      expect(putSnapshotSpy).toHaveBeenCalledWith('t1', 'Intent', expect.any(Array), 'PORTFOLIO_SNAPSHOT_IMPORTED');
    });

    it('should route CORPORATE_ACTION_APPLIED as intent side', async () => {
      getSnapshotSpy.mockResolvedValueOnce(null);
      await harness.process([
        fakeSqsRecord('CORPORATE_ACTION_APPLIED', {
          tenantId: 't1', positions: [{ symbol: 'AAPL', quantity: 100 }],
        }, { tenantId: 't1' }),
      ]);
      expect(putSnapshotSpy).toHaveBeenCalledWith('t1', 'Intent', expect.any(Array), 'CORPORATE_ACTION_APPLIED');
    });

    it('should skip unknown event types', async () => {
      const result = await harness.process([
        fakeSqsRecord('UNKNOWN_EVENT', {}, { tenantId: 't1' }),
      ]);
      expect(result.skipped).toBe(1);
      expect(reconcileSpy).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should report failure when reconciliation service throws', async () => {
      getSnapshotSpy.mockResolvedValueOnce({
        side: 'Settlement',
        positions: [],
        capturedAt: new Date().toISOString(),
        sourceEventType: 'ALPACA_ACCOUNT_SNAPSHOT',
      });
      reconcileSpy.mockImplementationOnce(() => { throw new Error('Compute failure'); });

      const result = await harness.process([
        fakeSqsRecord('PORTFOLIO_UPDATED',
          makePortfolioUpdatedSubject({}),
          { tenantId: 't1' }),
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.batchItemFailures).toHaveLength(1);
    });
  });
});
