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
    protected async queryAll(input: unknown) {
      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const result = await this.docClient.send(new QueryCommand(input));
      return result.Items ?? [];
    }
  },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

class MockNotRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotRetryableError';
  }
}

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
  authorizeTenant: (event: { identity?: Record<string, unknown> }) => {
    const claims = event.identity as Record<string, unknown> | undefined;
    const tenantId = (claims?.['claims'] as Record<string, string>)?.['custom:tenant_id'];
    if (!tenantId) throw new MockNotRetryableError('UNAUTHORIZED: missing tenantId');
    return tenantId;
  },
  validateQueryDepth: jest.fn(),
  applyMiddleware: jest.fn((handler) => handler),
  withLambdaContext: jest.fn(() => (next: unknown) => next),
  withTiming: jest.fn(() => (next: unknown) => next),
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
  withErrorPublishing: jest.fn().mockReturnValue((fn: unknown) => fn),
  EventBridgeBus: jest.fn(),
}));

jest.mock('@nestfolio/command-core', () => ({
  INITIAL_PORTFOLIO_STATE: {
    positions: {},
    cashBalanceCents: 10_000_000,
    lastEventSequence: 0,
  },
  replayEvents: jest.fn((_init, _entries, _reducer) => _init),
}));

import { AppSyncResolverEvent } from 'aws-lambda';
import { createResolver } from '../src/handlers/graphql-resolver';
import { LedgerRepository } from '../src/repositories/ledger.repository';
import { TimeTravelService } from '../src/services/time-travel.service';

function buildEvent(
  fieldName: string,
  args: Record<string, unknown> = {},
  tenantId = 'tenant-1',
): AppSyncResolverEvent<Record<string, unknown>> {
  return {
    info: { fieldName, parentTypeName: '', variables: {}, selectionSetList: [], selectionSetGraphQL: '' },
    arguments: args,
    identity: {
      claims: {
        'custom:tenant_id': tenantId,
        sub: 'user-1',
      },
    },
    source: null,
    request: { headers: {} },
    prev: null,
    stash: {},
  } as unknown as AppSyncResolverEvent<Record<string, unknown>>;
}

describe('order-ledger graphql-resolver handler', () => {
  const ORIGINAL_ENV = process.env;

  const repository = new LedgerRepository('test-table');
  const timeTravelService = new TimeTravelService(repository);
  let resolver: (event: AppSyncResolverEvent<Record<string, unknown>>) => Promise<unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ Items: [] });
    process.env = { ...ORIGINAL_ENV, TABLE_NAME: 'test-table' };

    resolver = createResolver({ repository, timeTravelService });
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('getLedgerPortfolio', () => {
    it('should return initial state when no snapshot exists', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] }); // getLatestSnapshot → empty

      const event = buildEvent('getLedgerPortfolio', { streamType: 'ACTUAL' });
      const result = await resolver(event) as Record<string, unknown>;

      expect(result['cashBalanceCents']).toBe(10_000_000);
      expect(result['positionCount']).toBe(0);
      expect(result['streamType']).toBe('ACTUAL');
    });

    it('should return snapshot data when snapshot exists', async () => {
      mockSend
        .mockResolvedValueOnce({
          Items: [{
            pk: 'Portfolio#tenant-1#actual',
            sk: 'Latest',
            cashBalanceCents: 8_000_000,
            totalValueCents: 12_000_000,
            positionCount: 3,
            snapshotAt: '2025-01-01T00:00:00.000Z',
          }],
        }) // getLatestSnapshot
        .mockResolvedValueOnce({
          Items: [
            { symbol: 'VTI', quantity: 10, averageCostBasis: 245.50 },
            { symbol: 'SPY', quantity: 5, averageCostBasis: 512.30 },
          ],
        }); // getPositionSnapshots

      const event = buildEvent('getLedgerPortfolio', { streamType: 'ACTUAL' });
      const result = await resolver(event) as Record<string, unknown>;

      expect(result['cashBalanceCents']).toBe(8_000_000);
      expect(result['totalValueCents']).toBe(12_000_000);
      expect((result['positions'] as unknown[]).length).toBe(2);
    });
  });

  describe('getSimulationComparison', () => {
    it('should return comparison with initial values when no snapshots exist', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [] }) // actual snapshot
        .mockResolvedValueOnce({ Items: [] }) // simulated snapshot
        .mockResolvedValueOnce({ Items: [] }) // actual positions
        .mockResolvedValueOnce({ Items: [] }) // simulated positions
        .mockResolvedValueOnce({ Items: [] }) // simulated decisions count
        .mockResolvedValueOnce({ Items: [] }); // actual decisions count

      const event = buildEvent('getSimulationComparison');
      const result = await resolver(event) as Record<string, unknown>;

      expect(result['actual']).toBeDefined();
      expect(result['simulated']).toBeDefined();
      expect(result['divergence']).toBeDefined();

      const divergence = result['divergence'] as Record<string, unknown>;
      expect(divergence['returnDifferencePercent']).toBe(0);
      expect(divergence['returnDifferenceCents']).toBe(0);
      expect(divergence['positionDifferences']).toEqual([]);
      expect(divergence['missedDecisions']).toBe(0);
      expect(divergence['totalDecisions']).toBe(0);
    });

    it('should compute position-level divergence between actual and simulated', async () => {
      mockSend
        .mockResolvedValueOnce({
          Items: [{ pk: 'Portfolio#t1#actual', sk: 'Latest', cashBalanceCents: 7_500_000, totalValueCents: 12_500_000, positionCount: 2, snapshotAt: '2025-01-01' }],
        }) // actual snapshot
        .mockResolvedValueOnce({
          Items: [{ pk: 'Portfolio#t1#simulated', sk: 'Latest', cashBalanceCents: 7_000_000, totalValueCents: 13_000_000, positionCount: 2, snapshotAt: '2025-01-01' }],
        }) // simulated snapshot
        .mockResolvedValueOnce({
          Items: [
            { symbol: 'VTI', quantity: 10, averageCostBasis: 250, totalCostBasis: 2500, lastFillPrice: 250.50 },
          ],
        }) // actual positions
        .mockResolvedValueOnce({
          Items: [
            { symbol: 'VTI', quantity: 15, averageCostBasis: 250, totalCostBasis: 3750, lastFillPrice: 250.50 },
            { symbol: 'SPY', quantity: 5, averageCostBasis: 520, totalCostBasis: 2600, lastFillPrice: 520.15 },
          ],
        }) // simulated positions
        .mockResolvedValueOnce({
          Items: [{ decisionId: 'd1' }, { decisionId: 'd2' }, { decisionId: 'd3' }],
        }) // simulated decisions (3 unique)
        .mockResolvedValueOnce({
          Items: [{ decisionId: 'd1' }],
        }); // actual decisions (1 unique)

      const event = buildEvent('getSimulationComparison');
      const result = await resolver(event) as Record<string, unknown>;

      const divergence = result['divergence'] as Record<string, unknown>;
      const posDiffs = divergence['positionDifferences'] as Array<Record<string, unknown>>;

      expect(posDiffs.length).toBe(2); // VTI + SPY
      const vtiDiff = posDiffs.find((p) => p['symbol'] === 'VTI')!;
      expect(vtiDiff['actualQuantity']).toBe(10);
      expect(vtiDiff['simulatedQuantity']).toBe(15);
      expect(vtiDiff['quantityDifference']).toBe(5);

      const spyDiff = posDiffs.find((p) => p['symbol'] === 'SPY')!;
      expect(spyDiff['actualQuantity']).toBe(0); // not in actual
      expect(spyDiff['simulatedQuantity']).toBe(5);

      expect(divergence['totalDecisions']).toBe(3);
      expect(divergence['missedDecisions']).toBe(2); // 3 simulated - 1 actual
    });

    it('should return positive divergence when simulated outperforms actual', async () => {
      mockSend
        .mockResolvedValueOnce({
          Items: [{ cashBalanceCents: 9_000_000, totalValueCents: 10_500_000, positionCount: 1, snapshotAt: '2025-01-01' }],
        }) // actual
        .mockResolvedValueOnce({
          Items: [{ cashBalanceCents: 8_500_000, totalValueCents: 11_200_000, positionCount: 2, snapshotAt: '2025-01-01' }],
        }) // simulated
        .mockResolvedValueOnce({ Items: [] }) // actual positions
        .mockResolvedValueOnce({ Items: [] }) // simulated positions
        .mockResolvedValueOnce({ Items: [] }) // simulated decisions
        .mockResolvedValueOnce({ Items: [] }); // actual decisions

      const event = buildEvent('getSimulationComparison');
      const result = await resolver(event) as Record<string, unknown>;

      const divergence = result['divergence'] as Record<string, unknown>;
      expect(divergence['returnDifferenceCents']).toBe(700_000); // 11.2M - 10.5M
      expect(divergence['returnDifferencePercent']).toBeGreaterThan(0);
    });
  });

  describe('getOrderHistory', () => {
    it('should return order history entries', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          { eventId: 'evt-1', eventType: 'ORDER_FILLED', orderId: 'o1', sequenceNo: 1, timestamp: '2025-01-01T00:00:00.000Z' },
          { eventId: 'evt-2', eventType: 'ORDER_FILLED', orderId: 'o1', sequenceNo: 2, timestamp: '2025-01-02T00:00:00.000Z' },
        ],
      });

      const event = buildEvent('getOrderHistory', { streamType: 'ACTUAL', orderId: 'o1' });
      const result = await resolver(event) as Record<string, unknown>;

      expect((result['entries'] as unknown[]).length).toBe(2);
      expect(result['hasMore']).toBe(false);
    });
  });

  describe('getPortfolioAt', () => {
    it('should return initial state when no checkpoints or entries exist', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [] }) // getCheckpointBefore → empty
        .mockResolvedValueOnce({ Items: [] }); // queryEntriesBetween → empty

      const event = buildEvent('getPortfolioAt', { streamType: 'ACTUAL', timestamp: '2025-06-15T00:00:00.000Z' });
      const result = await resolver(event) as Record<string, unknown>;

      expect(result['snapshotAt']).toBe('2025-06-15T00:00:00.000Z');
      expect(result['cashBalanceCents']).toBe(10_000_000);
      expect(result['positionCount']).toBe(0);
      expect(result['positions']).toEqual([]);
    });

    it('should replay from checkpoint when checkpoint exists', async () => {
      const checkpointState = {
        positions: { VTI: { symbol: 'VTI', quantity: 10, averageCostBasis: 250, totalCostBasis: 2500, lastFillPrice: 250 } },
        cashBalanceCents: 7_500_000,
      };
      mockSend
        .mockResolvedValueOnce({
          Items: [{
            pk: 'Portfolio#tenant-1#actual',
            sk: 'Checkpoint#2025-06-10',
            positions: checkpointState.positions,
            cashBalanceCents: checkpointState.cashBalanceCents,
            snapshotAt: '2025-06-10T23:59:59.000Z',
          }],
        }) // getCheckpointBefore
        .mockResolvedValueOnce({ Items: [] }); // queryEntriesBetween → no entries after checkpoint

      const event = buildEvent('getPortfolioAt', { streamType: 'ACTUAL', timestamp: '2025-06-15T00:00:00.000Z' });
      const result = await resolver(event) as Record<string, unknown>;

      expect(result['snapshotAt']).toBe('2025-06-15T00:00:00.000Z');
      expect(result['cashBalanceCents']).toBe(7_500_000);
      expect(result['positionCount']).toBe(1);
      const positions = result['positions'] as Array<Record<string, unknown>>;
      expect(positions[0]['symbol']).toBe('VTI');
      expect(positions[0]['quantity']).toBe(10);
    });

    it('should use streamType correctly for time-travel', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [] }) // getCheckpointBefore
        .mockResolvedValueOnce({ Items: [] }); // queryEntriesBetween

      const event = buildEvent('getPortfolioAt', { streamType: 'SIMULATED', timestamp: '2025-06-15T00:00:00.000Z' });
      const result = await resolver(event) as Record<string, unknown>;

      expect(result['streamType']).toBe('SIMULATED');
    });
  });

  describe('getTimeTravelAvailability', () => {
    it('should return available true with dates when checkpoints exist', async () => {
      mockSend
        .mockResolvedValueOnce({
          Items: [{ pk: 'Portfolio#tenant-1#actual', sk: 'Checkpoint#2025-01-15' }],
        }) // getEarliestCheckpoint
        .mockResolvedValueOnce({
          Items: [{ pk: 'Portfolio#tenant-1#actual', sk: 'Checkpoint#2025-06-10' }],
        }); // getCheckpointBefore (latest)

      const event = buildEvent('getTimeTravelAvailability');
      const result = await resolver(event) as Record<string, unknown>;

      expect(result['available']).toBe(true);
      expect(result['oldestDate']).toBe('2025-01-15');
      expect(result['latestDate']).toBe('2025-06-10');
    });

    it('should return available false when no checkpoints exist', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [] }) // getEarliestCheckpoint
        .mockResolvedValueOnce({ Items: [] }); // getCheckpointBefore

      const event = buildEvent('getTimeTravelAvailability');
      const result = await resolver(event) as Record<string, unknown>;

      expect(result['available']).toBe(false);
      expect(result['oldestDate']).toBeNull();
      expect(result['latestDate']).toBeNull();
    });

    it('should reject unauthorized tenant', async () => {
      const event = {
        info: { fieldName: 'getTimeTravelAvailability', parentTypeName: '', variables: {}, selectionSetList: [], selectionSetGraphQL: '' },
        arguments: {},
        identity: { claims: { sub: 'user-1' } },
        source: null,
        request: { headers: {} },
        prev: null,
        stash: {},
      } as unknown as AppSyncResolverEvent<Record<string, unknown>>;

      await expect(resolver(event)).rejects.toThrow('UNAUTHORIZED: missing tenantId');
    });
  });

  describe('authorization', () => {
    it('should throw when tenantId is missing from claims', async () => {
      const event = {
        info: { fieldName: 'getLedgerPortfolio', parentTypeName: '', variables: {}, selectionSetList: [], selectionSetGraphQL: '' },
        arguments: { streamType: 'ACTUAL' },
        identity: { claims: { sub: 'user-1' } },
        source: null,
        request: { headers: {} },
        prev: null,
        stash: {},
      } as unknown as AppSyncResolverEvent<Record<string, unknown>>;

      await expect(resolver(event)).rejects.toThrow('UNAUTHORIZED: missing tenantId');
    });
  });

  it('should throw for unknown field', async () => {
    const event = buildEvent('unknownField');
    await expect(resolver(event)).rejects.toThrow('Unknown field: unknownField');
  });
});
