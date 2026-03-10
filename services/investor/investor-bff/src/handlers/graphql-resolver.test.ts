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
import { createResolver } from './graphql-resolver';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';

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

  let handler: (event: AppSyncResolverEvent<Record<string, unknown>>) => Promise<unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, TABLE_NAME: 'test-table' };

    const repository = new InvestorProfileRepository('test-table');
    handler = createResolver({ repository });
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
    const result = await handler(event);
    expect(result).toEqual(profile);
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
    const result = await handler(event);
    expect(result).toMatchObject({ goalId: 'test-uuid', objective: 'Retirement' });
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
    const result = await handler(event);
    expect(result).toMatchObject({ mandateId: 'test-uuid', level: 'DISCRETIONARY' });
  });

  it('should resolve getGoals', async () => {
    const goals = [{ goalId: 'g1', objective: 'Retirement' }];
    mockSend.mockResolvedValueOnce({ Items: goals });

    const event = buildEvent('getGoals');
    const result = await handler(event);
    expect(result).toEqual(goals);
  });

  it('should resolve markNotificationRead', async () => {
    const updated = { notificationId: 'n1', status: 'READ', readAt: '2025-01-01T00:00:00.000Z' };
    mockSend.mockResolvedValueOnce({ Attributes: updated });

    const event = buildEvent('markNotificationRead', { notificationId: 'n1' });
    const result = await handler(event);
    expect(result).toMatchObject({ status: 'READ' });
  });

  it('should throw for unknown field', async () => {
    const event = buildEvent('unknownField');
    await expect(handler(event)).rejects.toThrow('Unknown field: unknownField');
  });

  it('should resolve setRiskProfile', async () => {
    mockSend.mockResolvedValueOnce({}); // transactWrite

    const input = {
      score: 7,
      band: { minEquity: 40, maxEquity: 80 },
    };

    const event = buildEvent('setRiskProfile', { input });
    const result = await handler(event);
    expect(result).toMatchObject({ score: 7, band: { minEquity: 40, maxEquity: 80 } });
  });

  it('should resolve selectOperatingMode', async () => {
    mockSend.mockResolvedValueOnce({}); // transactWrite

    const event = buildEvent('selectOperatingMode', { mode: 'AGGRESSIVE' });
    const result = await handler(event);
    expect(result).toMatchObject({ mode: 'AGGRESSIVE' });
  });

  it('should resolve updateGoal', async () => {
    const updated = { goalId: 'g1', objective: 'Early Retirement', targetAmountCents: 200000000 };
    mockSend
      .mockResolvedValueOnce({ Attributes: updated }) // UpdateCommand
      .mockResolvedValueOnce({}); // put editEvent

    const event = buildEvent('updateGoal', {
      goalId: 'g1',
      input: { objective: 'Early Retirement' },
    });

    const result = await handler(event);
    expect(result).toMatchObject({ goalId: 'g1', objective: 'Early Retirement' });
  });

  it('should resolve updateMandate', async () => {
    mockSend.mockResolvedValueOnce({}); // transactWrite

    const input = {
      level: 'ADVISORY',
      monthlyTurnoverCapPercent: 5,
      maxSingleTradePercent: 3,
      coolDownDays: 14,
      rebalanceCadence: 'QUARTERLY',
    };

    const event = buildEvent('updateMandate', { input });
    const result = await handler(event);
    expect(result).toMatchObject({ mandateId: 'test-uuid', level: 'ADVISORY' });
  });

  it('should resolve revokeMandate', async () => {
    const revoked = { mandateId: 'm1', revokedAt: '2025-01-01T00:00:00.000Z' };
    mockSend
      .mockResolvedValueOnce({ Attributes: revoked }) // UpdateCommand
      .mockResolvedValueOnce({}); // put editEvent

    const event = buildEvent('revokeMandate');
    const result = await handler(event);
    expect(result).toMatchObject({ revokedAt: '2025-01-01T00:00:00.000Z' });
  });

  it('should resolve initiateDeposit', async () => {
    const input = { amountCents: 50000, currency: 'EUR' };

    const event = buildEvent('initiateDeposit', { input });
    const result = await handler(event);
    expect(result).toMatchObject({
      depositId: 'test-uuid',
      amountCents: 50000,
      currency: 'EUR',
      status: 'PENDING',
    });
  });

  it('should resolve requestWithdrawal', async () => {
    const input = { amountCents: 25000, currency: 'USD' };

    const event = buildEvent('requestWithdrawal', { input });
    const result = await handler(event);
    expect(result).toMatchObject({
      withdrawalId: 'test-uuid',
      amountCents: 25000,
      currency: 'USD',
      status: 'PENDING',
    });
  });

  it('should resolve recordOnboardingAnswer', async () => {
    const input = { stepId: 'step-1', questionId: 'q-1', answer: 'A' };

    const event = buildEvent('recordOnboardingAnswer', { input });
    const result = await handler(event) as Record<string, unknown>;
    expect(result).toMatchObject({ step: 'COMPLETED' });
    expect(result.answeredAt).toBeDefined();
  });

  it('should resolve requestAccountClosure', async () => {
    const event = buildEvent('requestAccountClosure');
    const result = await handler(event) as Record<string, unknown>;
    expect(result).toMatchObject({ status: 'PENDING' });
    expect(result.requestedAt).toBeDefined();
  });

  it('should resolve getNotifications', async () => {
    const notifications = [
      { notificationId: 'n1', title: 'Hello', status: 'CREATED' },
      { notificationId: 'n2', title: 'World', status: 'READ' },
    ];
    mockSend.mockResolvedValueOnce({ Items: notifications });

    const event = buildEvent('getNotifications', { limit: 10 });
    const result = await handler(event) as { items: unknown[]; nextCursor: string | null };
    expect(result.items).toEqual(notifications);
    expect(result.nextCursor).toBeNull();
  });

  it('should resolve getUnreadCount', async () => {
    mockSend.mockResolvedValueOnce({ Count: 5 });

    const event = buildEvent('getUnreadCount');
    const result = await handler(event);
    expect(result).toBe(5);
  });

  describe('Zod validation', () => {
    it('should throw ZodError for invalid mutation input', async () => {
      // setRiskProfile expects score 1-10, band with minEquity/maxEquity
      const invalidInput = { score: 'not-a-number', band: 'invalid' };
      const event = buildEvent('setRiskProfile', { input: invalidInput });

      await expect(handler(event)).rejects.toThrow();
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

      await expect(handler(event)).rejects.toThrow('UNAUTHORIZED: missing tenantId');
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

      await expect(handler(event)).rejects.toThrow('UNAUTHORIZED: missing tenantId');
    });

    it('should succeed with valid tenantId and return data', async () => {
      const profile = { tenantId: 'tenant-1', email: 'test@example.com' };
      mockSend.mockResolvedValueOnce({ Item: profile });

      const event = buildEvent('getProfile');
      const result = await handler(event);
      expect(result).toEqual(profile);
    });
  });
});
