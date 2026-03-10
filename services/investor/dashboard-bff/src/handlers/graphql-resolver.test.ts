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
    TransactWriteCommand: jest.fn().mockImplementation((input) => ({ _type: 'TransactWrite', input })),
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
}));

class MockNotRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotRetryableError';
  }
}

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
  authorizeUser: (event: { identity?: Record<string, unknown> }) => {
    const claims = event.identity as Record<string, unknown> | undefined;
    const claimsMap = claims?.['claims'] as Record<string, string> | undefined;
    const tenantId = claimsMap?.['custom:tenant_id'];
    const userId = claimsMap?.['sub'];
    if (!tenantId) throw new MockNotRetryableError('UNAUTHORIZED: missing tenantId');
    if (!userId) throw new MockNotRetryableError('UNAUTHORIZED: missing userId');
    return { tenantId, userId };
  },
  validateQueryDepth: jest.fn(),
  applyMiddleware: jest.fn((handler: unknown) => handler),
  withLambdaContext: jest.fn().mockReturnValue((fn: unknown) => fn),
  withTiming: jest.fn().mockReturnValue((fn: unknown) => fn),
  withMethodLogging: jest.fn().mockImplementation(() =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
  withErrorPublishing: jest.fn().mockReturnValue((fn: unknown) => fn),
  EventBridgeBus: jest.fn(),
}));

import { AppSyncResolverEvent } from 'aws-lambda';
import { createResolver, ResolverDeps } from './graphql-resolver';
import { DashboardRepository } from '../repositories/dashboard.repository';

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

describe('dashboard-bff graphql-resolver handler', () => {
  const ORIGINAL_ENV = process.env;

  let handler: (event: AppSyncResolverEvent<Record<string, unknown>>) => Promise<unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, TABLE_NAME: 'test-table' };

    const resolverDeps: ResolverDeps = {
      repository: new DashboardRepository('test-table'),
    };

    handler = createResolver(resolverDeps);
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should resolve getDashboard with all 3 projections', async () => {
    const portfolioSummary = { totalValueCents: 12500000, positionCount: 5 };
    const advisoryStatus = { pendingDecisionsCount: 2 };
    const investorSnapshot = { goalType: 'Retirement', riskLevel: '7' };

    mockSend
      .mockResolvedValueOnce({ Item: portfolioSummary })
      .mockResolvedValueOnce({ Item: advisoryStatus })
      .mockResolvedValueOnce({ Item: investorSnapshot });

    const event = buildEvent('getDashboard');
    const result = await handler(event);
    expect(result).toEqual({
      portfolioSummary,
      advisoryStatus,
      investorSnapshot,
    });
  });

  it('should resolve getDashboard with null projections when none exist', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({ Item: undefined });

    const event = buildEvent('getDashboard');
    const result = await handler(event) as any;
    expect(result.portfolioSummary).toBeNull();
    expect(result.advisoryStatus).toBeNull();
    expect(result.investorSnapshot).toBeNull();
  });

  it('should resolve getPositionSnapshots', async () => {
    const positions = [
      { symbol: 'AAPL', quantity: 50 },
      { symbol: 'MSFT', quantity: 30 },
    ];
    mockSend.mockResolvedValueOnce({ Items: positions });

    const event = buildEvent('getPositionSnapshots');
    const result = await handler(event);
    expect(result).toEqual(positions);
  });

  it('should resolve getRecentActivity with default limit', async () => {
    const activities = [{ activityType: 'ORDER_FILLED', description: 'Order filled: AAPL' }];
    mockSend.mockResolvedValueOnce({ Items: activities });

    const event = buildEvent('getRecentActivity');
    const result = await handler(event);
    expect(result).toEqual(activities);
  });

  it('should resolve getRecentActivity with custom limit', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = buildEvent('getRecentActivity', { limit: 5 });
    const result = await handler(event);
    expect(result).toEqual([]);

    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.input.Limit).toBe(5);
  });

  describe('getTimeTravelAvailability', () => {
    it('should return default availability when no data exists', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const event = buildEvent('getTimeTravelAvailability');
      const result = await handler(event) as any;

      expect(result.available).toBe(false);
      expect(result.oldestDate).toBeNull();
      expect(result.latestDate).toBeNull();
    });

    it('should return availability data when it exists', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { available: true, oldestDate: '2025-01-01', latestDate: '2025-06-15' },
      });

      const event = buildEvent('getTimeTravelAvailability');
      const result = await handler(event) as any;

      expect(result.available).toBe(true);
      expect(result.oldestDate).toBe('2025-01-01');
      expect(result.latestDate).toBe('2025-06-15');
    });
  });

  describe('getSimulationSummary', () => {
    it('should return null when no simulation summary exists', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const event = buildEvent('getSimulationSummary');
      const result = await handler(event);

      expect(result).toBeNull();
    });

    it('should return simulation summary data when it exists', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          actualTotalValueCents: 10500000,
          simulatedTotalValueCents: 10800000,
          actualReturnPercent: 5.0,
          simulatedReturnPercent: 8.0,
          returnDifferencePercent: 3.0,
          updatedAt: '2025-06-15T12:00:00.000Z',
        },
      });

      const event = buildEvent('getSimulationSummary');
      const result = await handler(event) as any;

      expect(result.actualTotalValueCents).toBe(10500000);
      expect(result.simulatedTotalValueCents).toBe(10800000);
      expect(result.actualReturnPercent).toBe(5.0);
      expect(result.simulatedReturnPercent).toBe(8.0);
      expect(result.returnDifferencePercent).toBe(3.0);
      expect(result.updatedAt).toBe('2025-06-15T12:00:00.000Z');
    });
  });

  it('should throw for unknown field', async () => {
    const event = buildEvent('unknownField');
    await expect(handler(event)).rejects.toThrow('Unknown field: unknownField');
  });

  describe('tenant authorization', () => {
    it('should throw when tenantId is missing from claims', async () => {
      const event = {
        info: { fieldName: 'getDashboard', parentTypeName: '', variables: {}, selectionSetList: [], selectionSetGraphQL: '' },
        arguments: {},
        identity: { claims: { sub: 'user-1' } },
        source: null,
        request: { headers: {} },
        prev: null,
        stash: {},
      } as unknown as AppSyncResolverEvent<Record<string, unknown>>;

      await expect(handler(event)).rejects.toThrow('UNAUTHORIZED: missing tenantId');
    });

    it('should throw when identity is undefined', async () => {
      const event = {
        info: { fieldName: 'getDashboard', parentTypeName: '', variables: {}, selectionSetList: [], selectionSetGraphQL: '' },
        arguments: {},
        identity: undefined,
        source: null,
        request: { headers: {} },
        prev: null,
        stash: {},
      } as unknown as AppSyncResolverEvent<Record<string, unknown>>;

      await expect(handler(event)).rejects.toThrow('UNAUTHORIZED: missing tenantId');
    });

    it('should throw when userId (sub) is missing from claims', async () => {
      const event = {
        info: { fieldName: 'getDashboard', parentTypeName: '', variables: {}, selectionSetList: [], selectionSetGraphQL: '' },
        arguments: {},
        identity: { claims: { 'custom:tenant_id': 'tenant-1' } },
        source: null,
        request: { headers: {} },
        prev: null,
        stash: {},
      } as unknown as AppSyncResolverEvent<Record<string, unknown>>;

      await expect(handler(event)).rejects.toThrow('UNAUTHORIZED: missing userId');
    });

    it('should succeed with valid tenantId and return data', async () => {
      const portfolioSummary = { totalValueCents: 12500000 };
      mockSend
        .mockResolvedValueOnce({ Item: portfolioSummary })
        .mockResolvedValueOnce({ Item: null })
        .mockResolvedValueOnce({ Item: null });

      const event = buildEvent('getDashboard');
      const result = await handler(event) as any;
      expect(result.portfolioSummary).toEqual(portfolioSummary);
    });
  });
});
