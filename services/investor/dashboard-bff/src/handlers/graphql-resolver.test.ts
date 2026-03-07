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
  },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import { AppSyncResolverEvent } from 'aws-lambda';

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

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, TABLE_NAME: 'test-table' };
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

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('./graphql-resolver');
      const result = await handler(event);
      expect(result).toEqual({
        portfolioSummary,
        advisoryStatus,
        investorSnapshot,
      });
    });
  });

  it('should resolve getDashboard with null projections when none exist', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({ Item: undefined });

    const event = buildEvent('getDashboard');

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('./graphql-resolver');
      const result = await handler(event);
      expect(result.portfolioSummary).toBeNull();
      expect(result.advisoryStatus).toBeNull();
      expect(result.investorSnapshot).toBeNull();
    });
  });

  it('should resolve getPositionSnapshots', async () => {
    const positions = [
      { symbol: 'AAPL', quantity: 50 },
      { symbol: 'MSFT', quantity: 30 },
    ];
    mockSend.mockResolvedValueOnce({ Items: positions });

    const event = buildEvent('getPositionSnapshots');

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('./graphql-resolver');
      const result = await handler(event);
      expect(result).toEqual(positions);
    });
  });

  it('should resolve getRecentActivity with default limit', async () => {
    const activities = [{ activityType: 'ORDER_FILLED', description: 'Order filled: AAPL' }];
    mockSend.mockResolvedValueOnce({ Items: activities });

    const event = buildEvent('getRecentActivity');

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('./graphql-resolver');
      const result = await handler(event);
      expect(result).toEqual(activities);
    });
  });

  it('should resolve getRecentActivity with custom limit', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = buildEvent('getRecentActivity', { limit: 5 });

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('./graphql-resolver');
      const result = await handler(event);
      expect(result).toEqual([]);
    });

    const cmd = mockSend.mock.calls[0][0];
    expect(cmd.input.Limit).toBe(5);
  });

  it('should throw for unknown field', async () => {
    const event = buildEvent('unknownField');

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('./graphql-resolver');
      await expect(handler(event)).rejects.toThrow('Unknown field: unknownField');
    });
  });
});
