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
class MockNotRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotRetryableError';
  }
}

jest.mock('@nestfolio/command-core', () => ({
  INITIAL_ACCOUNT_STATE: {
    positions: {},
    cashBalanceCents: 10_000_000,
    lastEventSequence: 0,
  },
  replayEvents: jest.fn((_init, _entries, _reducer) => _init),
}));

import { AppSyncResolverEvent } from 'aws-lambda';
import { createResolver } from '../../src/handlers/graphql-resolver';
import { PortfolioRepository } from '../../src/repositories/portfolio.repository';
import { TimeTravelService } from '../../src/services/time-travel.service';

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

describe('ledger-bff graphql-resolver handler', () => {
  const ORIGINAL_ENV = process.env;

  const repository = new PortfolioRepository('test-table');
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

  describe('getPortfolioAt', () => {
    it('should return initial state when no checkpoints or entries exist', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [] }) // getCheckpointBefore
        .mockResolvedValueOnce({ Items: [] }); // getEntriesSince

      const event = buildEvent('getPortfolioAt', { timestamp: '2025-06-15T00:00:00.000Z' });
      const result = await resolver(event) as Record<string, unknown>;

      expect(result['cashBalanceCents']).toBe(10_000_000);
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
            pk: 'Checkpoint#tenant-1',
            sk: '2025-06-10',
            positions: checkpointState.positions,
            cashBalanceCents: checkpointState.cashBalanceCents,
            snapshotAt: '2025-06-10T23:59:59.000Z',
          }],
        }) // getCheckpointBefore
        .mockResolvedValueOnce({ Items: [] }); // getEntriesSince

      const event = buildEvent('getPortfolioAt', { timestamp: '2025-06-15T00:00:00.000Z' });
      const result = await resolver(event) as Record<string, unknown>;

      expect(result['cashBalanceCents']).toBe(7_500_000);
      const positions = result['positions'] as Array<Record<string, unknown>>;
      expect(positions).toHaveLength(1);
      expect(positions[0]['symbol']).toBe('VTI');
    });
  });

  describe('getSimulationComparison', () => {
    it('should return comparison with initial values when no data exists', async () => {
      mockSend
        .mockResolvedValueOnce({}) // getLatest → no Item
        .mockResolvedValueOnce({}) // getSimulationLatest → no Item
        .mockResolvedValueOnce({ Items: [] }) // getPositions
        .mockResolvedValueOnce({ Items: [] }); // getSimulationPositions

      const event = buildEvent('getSimulationComparison');
      const result = await resolver(event) as Record<string, unknown>;

      expect(result['actual']).toBeDefined();
      expect(result['simulated']).toBeDefined();
      expect(result['cashDeltaCents']).toBe(0);
      expect(result['positionDiffs']).toEqual([]);
    });

    it('should compute position-level diffs between actual and simulated', async () => {
      mockSend
        .mockResolvedValueOnce({
          Item: { cashBalanceCents: 7_500_000 },
        }) // getLatest
        .mockResolvedValueOnce({
          Item: { cashBalanceCents: 7_000_000 },
        }) // getSimulationLatest
        .mockResolvedValueOnce({
          Items: [
            { symbol: 'VTI', quantity: 10, averageCostBasis: 250, totalCostBasis: 2500, lastFillPrice: 250.50 },
          ],
        }) // getPositions
        .mockResolvedValueOnce({
          Items: [
            { symbol: 'VTI', quantity: 15, averageCostBasis: 250, totalCostBasis: 3750, lastFillPrice: 250.50 },
            { symbol: 'SPY', quantity: 5, averageCostBasis: 520, totalCostBasis: 2600, lastFillPrice: 520.15 },
          ],
        }); // getSimulationPositions

      const event = buildEvent('getSimulationComparison');
      const result = await resolver(event) as Record<string, unknown>;

      expect(result['cashDeltaCents']).toBe(-500_000); // 7M - 7.5M
      const diffs = result['positionDiffs'] as Array<Record<string, unknown>>;
      expect(diffs.length).toBe(2);

      const vtiDiff = diffs.find((d) => d['symbol'] === 'VTI')!;
      expect(vtiDiff['actualQuantity']).toBe(10);
      expect(vtiDiff['simulatedQuantity']).toBe(15);
      expect(vtiDiff['quantityDiff']).toBe(5);

      const spyDiff = diffs.find((d) => d['symbol'] === 'SPY')!;
      expect(spyDiff['actualQuantity']).toBe(0);
      expect(spyDiff['simulatedQuantity']).toBe(5);
    });
  });

  describe('authorization', () => {
    it('should throw when tenantId is missing from claims', async () => {
      const event = {
        info: { fieldName: 'getPortfolioAt', parentTypeName: '', variables: {}, selectionSetList: [], selectionSetGraphQL: '' },
        arguments: { timestamp: '2025-06-15T00:00:00.000Z' },
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
