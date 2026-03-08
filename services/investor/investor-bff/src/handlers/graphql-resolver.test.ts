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
}));

jest.mock('@nestfolio/domain-core', () => ({
  EntityNotFoundError: class EntityNotFoundError extends Error {
    constructor(public entityType: string, public entityId: string) {
      super(`${entityType} with id '${entityId}' not found`);
      this.name = 'EntityNotFoundError';
    }
  },
}));

import { AppSyncResolverEvent } from 'aws-lambda';

function buildEvent(
  fieldName: string,
  args: Record<string, unknown> = {},
  tenantId = 'tenant-1',
  userId = 'user-1',
): AppSyncResolverEvent<Record<string, unknown>> {
  return {
    info: { fieldName, parentTypeName: '', variables: {}, selectionSetList: [], selectionSetGraphQL: '' },
    arguments: args,
    identity: {
      claims: {
        'custom:tenant_id': tenantId,
        sub: userId,
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

  it('should resolve getProfile', async () => {
    const profile = {
      pk: 'InvestorProfile#tenant-1#user-1',
      sk: 'InvestorProfile',
      __typename: 'InvestorProfile',
      tenantId: 'tenant-1',
      email: 'test@example.com',
    };
    mockSend.mockResolvedValueOnce({ Item: profile });

    const event = buildEvent('getProfile');

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('./graphql-resolver');
      const result = await handler(event);
      expect(result).toEqual(profile);
    });
  });

  it('should resolve setGoal', async () => {
    mockSend.mockResolvedValueOnce({}); // transactWrite

    const input = {
      objective: 'Retirement',
      targetAmountCents: 100000000,
      currency: 'USD',
      timeHorizonMonths: 360,
      targetReturn: 0.07,
    };

    const event = buildEvent('setGoal', { input });

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('./graphql-resolver');
      const result = await handler(event);
      expect(result).toMatchObject({ goalId: 'test-uuid', objective: 'Retirement' });
    });
  });

  it('should resolve grantMandate', async () => {
    mockSend.mockResolvedValueOnce({}); // transactWrite

    const input = {
      level: 'DISCRETIONARY',
      monthlyTurnoverCapPercent: 10,
      maxSingleTradePercent: 5,
      coolDownDays: 7,
      rebalanceCadence: 'MONTHLY',
    };

    const event = buildEvent('grantMandate', { input });

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('./graphql-resolver');
      const result = await handler(event);
      expect(result).toMatchObject({ mandateId: 'test-uuid', level: 'DISCRETIONARY' });
    });
  });

  it('should resolve getGoals', async () => {
    const goals = [{ goalId: 'g1', objective: 'Retirement' }];
    mockSend.mockResolvedValueOnce({ Items: goals });

    const event = buildEvent('getGoals');

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('./graphql-resolver');
      const result = await handler(event);
      expect(result).toEqual(goals);
    });
  });

  it('should resolve markNotificationRead', async () => {
    const updated = { notificationId: 'n1', status: 'READ', readAt: '2025-01-01T00:00:00.000Z' };
    mockSend.mockResolvedValueOnce({ Attributes: updated });

    const event = buildEvent('markNotificationRead', { notificationId: 'n1' });

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('./graphql-resolver');
      const result = await handler(event);
      expect(result).toMatchObject({ status: 'READ' });
    });
  });

  it('should throw for unknown field', async () => {
    const event = buildEvent('unknownField');

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('./graphql-resolver');
      await expect(handler(event)).rejects.toThrow('Unknown field: unknownField');
    });
  });

  describe('tenant authorization', () => {
    it('should throw when tenantId is missing from claims', async () => {
      const event = {
        info: { fieldName: 'getProfile', parentTypeName: '', variables: {}, selectionSetList: [], selectionSetGraphQL: '' },
        arguments: {},
        identity: { claims: { sub: 'user-1' } },
        source: null,
        request: { headers: {} },
        prev: null,
        stash: {},
      } as unknown as AppSyncResolverEvent<Record<string, unknown>>;

      await jest.isolateModulesAsync(async () => {
        const { handler } = require('./graphql-resolver');
        await expect(handler(event)).rejects.toThrow('UNAUTHORIZED: missing tenantId');
      });
    });

    it('should throw when identity is undefined', async () => {
      const event = {
        info: { fieldName: 'getProfile', parentTypeName: '', variables: {}, selectionSetList: [], selectionSetGraphQL: '' },
        arguments: {},
        identity: undefined,
        source: null,
        request: { headers: {} },
        prev: null,
        stash: {},
      } as unknown as AppSyncResolverEvent<Record<string, unknown>>;

      await jest.isolateModulesAsync(async () => {
        const { handler } = require('./graphql-resolver');
        await expect(handler(event)).rejects.toThrow('UNAUTHORIZED: missing tenantId');
      });
    });

    it('should succeed with valid tenantId and return data', async () => {
      const profile = { tenantId: 'tenant-1', email: 'test@example.com' };
      mockSend.mockResolvedValueOnce({ Item: profile });

      const event = buildEvent('getProfile');

      await jest.isolateModulesAsync(async () => {
        const { handler } = require('./graphql-resolver');
        const result = await handler(event);
        expect(result).toEqual(profile);
      });
    });
  });
});
