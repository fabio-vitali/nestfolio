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

import { AppSyncResolverEvent } from 'aws-lambda';
import { createResolver } from '../src/handlers/graphql-resolver';
import { PortfolioRepository } from '../src/repositories/portfolio.repository';

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

describe('graphql-resolver handler', () => {
  const ORIGINAL_ENV = process.env;

  const repository = new PortfolioRepository('test-table');
  let resolver: (event: AppSyncResolverEvent<Record<string, unknown>>) => Promise<unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, TABLE_NAME: 'test-table' };

    resolver = createResolver({ repository });
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should resolve getPortfolio', async () => {
    const portfolio = {
      pk: 'Portfolio#tenant-1#tenant-1',
      sk: 'Portfolio',
      __typename: 'Portfolio',
      tenantId: 'tenant-1',
      portfolioId: 'tenant-1',
      totalValue: 100000,
    };
    mockSend.mockResolvedValueOnce({ Item: portfolio });

    const event = buildEvent('getPortfolio');
    const result = await resolver(event);
    expect(result).toEqual(portfolio);
  });

  it('should resolve getPositions', async () => {
    const positions = [
      { instrument: 'AAPL', quantity: 100 },
      { instrument: 'MSFT', quantity: 50 },
    ];
    mockSend.mockResolvedValueOnce({ Items: positions });

    const event = buildEvent('getPositions');
    const result = await resolver(event);
    expect(result).toEqual(positions);
  });

  it('should resolve getCashBalance with default currency', async () => {
    const balance = { currency: 'USD', amount: 50000, updatedAt: '2025-01-01T00:00:00.000Z' };
    mockSend.mockResolvedValueOnce({ Item: balance });

    const event = buildEvent('getCashBalance');
    const result = await resolver(event);
    expect(result).toEqual(balance);
  });

  it('should resolve getPerformance', async () => {
    const event = buildEvent('getPerformance', { period: 'MONTH' });
    const result = await resolver(event);
    expect(result).toMatchObject({
      period: 'MONTH',
      returnPercent: 0,
      returnAbsolute: 0,
    });
  });

  it('should throw for unknown field', async () => {
    const event = buildEvent('unknownField');
    await expect(resolver(event)).rejects.toThrow('Unknown field: unknownField');
  });

  describe('tenant authorization', () => {
    it('should throw when tenantId is missing from claims', async () => {
      const event = {
        info: { fieldName: 'getPortfolio', parentTypeName: '', variables: {}, selectionSetList: [], selectionSetGraphQL: '' },
        arguments: {},
        identity: { claims: { sub: 'user-1' } },
        source: null,
        request: { headers: {} },
        prev: null,
        stash: {},
      } as unknown as AppSyncResolverEvent<Record<string, unknown>>;

      await expect(resolver(event)).rejects.toThrow('UNAUTHORIZED: missing tenantId');
    });

    it('should throw when identity is undefined', async () => {
      const event = {
        info: { fieldName: 'getPortfolio', parentTypeName: '', variables: {}, selectionSetList: [], selectionSetGraphQL: '' },
        arguments: {},
        identity: undefined,
        source: null,
        request: { headers: {} },
        prev: null,
        stash: {},
      } as unknown as AppSyncResolverEvent<Record<string, unknown>>;

      await expect(resolver(event)).rejects.toThrow('UNAUTHORIZED: missing tenantId');
    });

    it('should succeed with valid tenantId and return data', async () => {
      const portfolio = { tenantId: 'tenant-1', portfolioId: 'tenant-1', totalValue: 100000 };
      mockSend.mockResolvedValueOnce({ Item: portfolio });

      const event = buildEvent('getPortfolio');
      const result = await resolver(event);
      expect(result).toEqual(portfolio);
    });
  });
});
