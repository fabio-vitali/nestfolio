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
import { createHandlers, type EventListenerDeps } from '../src/handlers/event-listener';
import { ReconciliationRepository } from '../src/repositories/reconciliation.repository';
import { ReconciliationService } from '../src/services/reconciliation.service';

describe('reconciliation-ctrl event-listener', () => {
  const repository = new ReconciliationRepository('test-table');
  const reconciliationService = new ReconciliationService(repository);
  const reconcileSpy = jest.spyOn(reconciliationService, 'reconcile');

  const mockDeps: EventListenerDeps = { reconciliationService };

  const harness = createTestHarness({
    serviceName: 'reconciliation-ctrl',
    handlers: createHandlers(mockDeps),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  it('routes PORTFOLIO_SNAPSHOT_IMPORTED to reconciliation service', async () => {
    reconcileSpy.mockReturnValueOnce({ status: 'COMPLETED', drifts: [] });
    const result = await harness.process([
      fakeSqsRecord('PORTFOLIO_SNAPSHOT_IMPORTED', {
        tenantId: 't1', portfolioId: 'p1',
        positions: [{ symbol: 'AAPL', quantity: 100 }],
      }, { tenantId: 't1' }),
    ]);
    expect(result.metrics.EventProcessed).toBe(1);
    expect(reconcileSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        tenantId: 't1',
        portfolioId: 'p1',
        intentPositions: [{ instrument: 'AAPL', quantity: 100 }],
        settlementPositions: [{ instrument: 'AAPL', quantity: 100 }],
      }),
    );
  });

  it('routes PORTFOLIO_UPDATED to reconciliation service', async () => {
    reconcileSpy.mockReturnValueOnce({ status: 'COMPLETED', drifts: [] });
    await harness.process([
      fakeSqsRecord('PORTFOLIO_UPDATED', {
        tenantId: 't1', portfolioId: 'p1', positions: [],
      }, { tenantId: 't1' }),
    ]);
    expect(reconcileSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tenantId: 't1', portfolioId: 'p1' }),
    );
  });

  it('routes CORPORATE_ACTION_APPLIED to reconciliation service', async () => {
    reconcileSpy.mockReturnValueOnce({ status: 'COMPLETED', drifts: [] });
    await harness.process([
      fakeSqsRecord('CORPORATE_ACTION_APPLIED', {
        tenantId: 't1', portfolioId: 'p1', positions: [],
      }, { tenantId: 't1' }),
    ]);
    expect(reconcileSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tenantId: 't1', portfolioId: 'p1' }),
    );
  });

  it('skips unknown event types', async () => {
    const result = await harness.process([
      fakeSqsRecord('UNKNOWN_EVENT', {}, { tenantId: 't1' }),
    ]);
    expect(result.skipped).toBe(1);
    expect(reconcileSpy).not.toHaveBeenCalled();
  });

  it('reports failure when reconciliation service throws', async () => {
    reconcileSpy.mockImplementationOnce(() => { throw new Error('Compute failure'); });
    const result = await harness.process([
      fakeSqsRecord('PORTFOLIO_UPDATED', {
        tenantId: 't1', portfolioId: 'p1',
        positions: [{ symbol: 'AAPL', quantity: 100 }],
      }, { tenantId: 't1' }),
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.batchItemFailures).toHaveLength(1);
  });

  it('defaults portfolioId to tenantId when not provided', async () => {
    reconcileSpy.mockReturnValueOnce({ status: 'COMPLETED', drifts: [] });
    await harness.process([
      fakeSqsRecord('PORTFOLIO_UPDATED', { positions: [] }, { tenantId: 't1' }),
    ]);
    expect(reconcileSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tenantId: 't1', portfolioId: 't1' }),
    );
  });

  it('defaults positions to empty array when not provided', async () => {
    reconcileSpy.mockReturnValueOnce({ status: 'COMPLETED', drifts: [] });
    await harness.process([
      fakeSqsRecord('PORTFOLIO_UPDATED', { portfolioId: 'p1' }, { tenantId: 't1' }),
    ]);
    expect(reconcileSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ intentPositions: [], settlementPositions: [] }),
    );
  });

  it('returns ReconciliationResult record with COMPLETED status and no drifts', async () => {
    reconcileSpy.mockReturnValueOnce({ status: 'COMPLETED', drifts: [] });
    const result = await harness.process([
      fakeSqsRecord('PORTFOLIO_UPDATED', {
        tenantId: 't1', portfolioId: 'p1', positions: [],
      }, { tenantId: 't1', eventId: 'evt-1' }),
    ]);
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({
      _tag: 'record',
      typename: 'ReconciliationResult',
      fields: expect.objectContaining({
        tenantId: 't1',
        reconciliationId: 'evt-1',
        status: 'COMPLETED',
        driftCount: 0,
      }),
    });
  });

  it('returns ReconciliationResult + DriftRecord intents when drift is detected', async () => {
    reconcileSpy.mockReturnValueOnce({
      status: 'DRIFT_DETECTED',
      drifts: [
        { instrument: 'AAPL', intentQty: 100, settlementQty: 90, drift: 10 },
        { instrument: 'TSLA', intentQty: 50, settlementQty: 55, drift: -5 },
      ],
    });
    const result = await harness.process([
      fakeSqsRecord('PORTFOLIO_UPDATED', {
        tenantId: 't1', portfolioId: 'p1',
        positions: [{ symbol: 'AAPL', quantity: 100 }, { symbol: 'TSLA', quantity: 50 }],
      }, { tenantId: 't1', eventId: 'evt-2' }),
    ]);
    expect(result.intents).toHaveLength(3);
    expect(result.intents[0]).toMatchObject({
      _tag: 'record',
      typename: 'ReconciliationResult',
      fields: expect.objectContaining({
        tenantId: 't1',
        reconciliationId: 'evt-2',
        status: 'DRIFT_DETECTED',
        driftCount: 2,
      }),
    });
    expect(result.intents[1]).toMatchObject({
      _tag: 'record',
      typename: 'DriftRecord',
      fields: expect.objectContaining({
        tenantId: 't1',
        reconciliationId: 'evt-2',
        instrument: 'AAPL',
        intentQty: 100,
        settlementQty: 90,
        drift: 10,
      }),
    });
    expect(result.intents[2]).toMatchObject({
      _tag: 'record',
      typename: 'DriftRecord',
      fields: expect.objectContaining({
        tenantId: 't1',
        reconciliationId: 'evt-2',
        instrument: 'TSLA',
        intentQty: 50,
        settlementQty: 55,
        drift: -5,
      }),
    });
  });
});
