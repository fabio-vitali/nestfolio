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

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
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

describe('graphql-resolver handler', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, TABLE_NAME: 'test-table' };
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

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/graphql-resolver');
      const result = await handler(event);
      expect(result).toEqual(portfolio);
    });
  });

  it('should resolve getPositions', async () => {
    const positions = [
      { instrument: 'AAPL', quantity: 100 },
      { instrument: 'MSFT', quantity: 50 },
    ];
    mockSend.mockResolvedValueOnce({ Items: positions });

    const event = buildEvent('getPositions');

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/graphql-resolver');
      const result = await handler(event);
      expect(result).toEqual(positions);
    });
  });

  it('should resolve getCashBalance with default currency', async () => {
    const balance = { currency: 'USD', amount: 50000, updatedAt: '2025-01-01T00:00:00.000Z' };
    mockSend.mockResolvedValueOnce({ Item: balance });

    const event = buildEvent('getCashBalance');

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/graphql-resolver');
      const result = await handler(event);
      expect(result).toEqual(balance);
    });
  });

  it('should resolve getPerformance', async () => {
    const event = buildEvent('getPerformance', { period: 'MONTH' });

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/graphql-resolver');
      const result = await handler(event);
      expect(result).toMatchObject({
        period: 'MONTH',
        returnPercent: 0,
        returnAbsolute: 0,
      });
    });
  });

  it('should throw for unknown field', async () => {
    const event = buildEvent('unknownField');

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/graphql-resolver');
      await expect(handler(event)).rejects.toThrow('Unknown field: unknownField');
    });
  });
});
