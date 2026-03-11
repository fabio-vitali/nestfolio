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
        KeyConditionExpression: skPrefix
          ? 'pk = :pk AND begins_with(sk, :sk)'
          : 'pk = :pk',
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
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
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
    const tenantId = (claims?.['claims'] as Record<string, string>)?.['custom:tenant_id'];
    const userId = (claims?.['claims'] as Record<string, string>)?.['sub'] ?? (claims?.['sub'] as string);
    if (!tenantId) throw new MockNotRetryableError('UNAUTHORIZED: missing tenantId');
    return { tenantId, userId: userId ?? 'user-1' };
  },
  validateQueryDepth: jest.fn(),
  applyMiddleware: jest.fn((handler: unknown) => handler),
  withLambdaContext: jest.fn().mockReturnValue((fn: unknown) => fn),
  withTiming: jest.fn().mockReturnValue((fn: unknown) => fn),
  withMethodLogging: jest.fn().mockReturnValue((_name: string, fn: (...args: unknown[]) => unknown) => fn),
  withErrorPublishing: jest.fn().mockReturnValue((fn: unknown) => fn),
  EventBridgeBus: jest.fn(),
}));
jest.mock('@nestfolio/domain-core', () => ({}));

import { AppSyncResolverEvent } from 'aws-lambda';
import { AdvisoryRepository } from '../src/repositories/advisory.repository';
import { createResolver, type ResolverDeps } from '../src/handlers/graphql-resolver';

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
  let resolverDeps: ResolverDeps;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, TABLE_NAME: 'test-table' };

    resolverDeps = {
      repository: new AdvisoryRepository('test-table'),
    };

    handler = createResolver(resolverDeps);
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should resolve getDecision', async () => {
    const decision = {
      pk: 'Decision#tenant-1#d1',
      sk: 'DecisionReadModel',
      __typename: 'DecisionReadModel',
      decisionId: 'd1',
      tenantId: 'tenant-1',
      status: 'PROPOSED',
    };
    mockSend.mockResolvedValueOnce({ Items: [decision] });

    const event = buildEvent('getDecision', { decisionId: 'd1' });

    const result = await handler(event);
    expect(result).toEqual(decision);
  });

  it('should resolve getPendingDecisions', async () => {
    const decisions = [
      { decisionId: 'd1', status: 'PROPOSED' },
      { decisionId: 'd2', status: 'APPROVED' },
    ];
    mockSend.mockResolvedValueOnce({ Items: decisions });

    const event = buildEvent('getPendingDecisions', { limit: 10 });

    const result = await handler(event) as { items: unknown[] };
    expect(result.items).toEqual(decisions);
  });

  it('should resolve confirmDecision', async () => {
    // transactWrite for updateDecisionStatus
    mockSend.mockResolvedValueOnce({});
    // put for putUserConfirmation
    mockSend.mockResolvedValueOnce({});
    // queryByPk for getDecision
    const confirmed = {
      decisionId: 'd1',
      tenantId: 'tenant-1',
      status: 'CONFIRMED',
      confirmedAt: '2025-01-01T00:00:00.000Z',
    };
    mockSend.mockResolvedValueOnce({ Items: [confirmed] });

    const event = buildEvent('confirmDecision', { decisionId: 'd1' });

    const result = await handler(event);
    expect(result).toMatchObject({ status: 'CONFIRMED' });

    // Verify UserConfirmation record was written for Egress CDC
    const putCall = mockSend.mock.calls[1][0];
    expect(putCall.input.Item).toMatchObject({
      __typename: 'UserConfirmation',
      decisionId: 'd1',
      userId: 'user-1',
    });
  });

  it('should resolve rejectDecision', async () => {
    // transactWrite for updateDecisionStatus
    mockSend.mockResolvedValueOnce({});
    // put for putUserRejection
    mockSend.mockResolvedValueOnce({});
    // queryByPk for getDecision
    const rejected = {
      decisionId: 'd1',
      tenantId: 'tenant-1',
      status: 'REJECTED',
      rejectedAt: '2025-01-01T00:00:00.000Z',
      rejectionReason: 'Too risky',
    };
    mockSend.mockResolvedValueOnce({ Items: [rejected] });

    const event = buildEvent('rejectDecision', { decisionId: 'd1', reason: 'Too risky' });

    const result = await handler(event);
    expect(result).toMatchObject({ status: 'REJECTED', rejectionReason: 'Too risky' });

    // Verify UserRejection record was written for Egress CDC
    const putCall = mockSend.mock.calls[1][0];
    expect(putCall.input.Item).toMatchObject({
      __typename: 'UserRejection',
      decisionId: 'd1',
      userId: 'user-1',
      rejectionReason: 'Too risky',
    });
  });

  it('should resolve recordExplanationView', async () => {
    // put for recordUserInteraction
    mockSend.mockResolvedValueOnce({});

    const event = buildEvent('recordExplanationView', { decisionId: 'd1' });

    const result = await handler(event);
    expect(result).toEqual({
      decisionId: 'd1',
      viewedAt: '2025-01-01T00:00:00.000Z',
    });
  });

  it('should resolve getAgentInvocations', async () => {
    const invocations = [
      { invocationId: 'inv-1', agentId: 'portfolio-agent', tier: 'sonnet', status: 'COMPLETED' },
      { invocationId: 'inv-2', agentId: 'risk-agent', tier: 'haiku', status: 'COMPLETED' },
    ];
    mockSend.mockResolvedValueOnce({ Items: invocations });

    const event = buildEvent('getAgentInvocations', { decisionId: 'd1' });

    const result = await handler(event);
    expect(result).toEqual(invocations);
  });

  it('should resolve getComplianceChecks', async () => {
    const checks = [
      { checkId: 'chk-1', rule: 'MAX_CONCENTRATION', passed: true },
      { checkId: 'chk-2', rule: 'RISK_LIMIT', passed: false, reason: 'Exceeds band' },
    ];
    mockSend.mockResolvedValueOnce({ Items: checks });

    const event = buildEvent('getComplianceChecks', { decisionId: 'd1' });

    const result = await handler(event);
    expect(result).toEqual(checks);
  });

  it('should resolve getDecisionHistory', async () => {
    const decisions = [
      { decisionId: 'd1', status: 'CONFIRMED' },
      { decisionId: 'd2', status: 'REJECTED' },
    ];
    mockSend.mockResolvedValueOnce({ Items: decisions });

    const event = buildEvent('getDecisionHistory', { limit: 10 });

    const result = await handler(event) as { items: unknown[] };
    expect(result.items).toEqual(decisions);
  });

  describe('Zod validation', () => {
    it('should throw ZodError for invalid mutation input', async () => {
      // rejectDecision requires decisionId (non-empty string) and reason (non-empty string)
      const event = buildEvent('rejectDecision', { decisionId: '', reason: '' });

      await expect(handler(event)).rejects.toThrow();
    });
  });

  describe('tenant authorization', () => {
    it('should throw when tenantId is missing from claims', async () => {
      const event = {
        info: { fieldName: 'getDecision', parentTypeName: '', variables: {}, selectionSetList: [], selectionSetGraphQL: '' },
        arguments: { decisionId: 'd1' },
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
        info: { fieldName: 'getDecision', parentTypeName: '', variables: {}, selectionSetList: [], selectionSetGraphQL: '' },
        arguments: { decisionId: 'd1' },
        identity: undefined,
        source: null,
        request: { headers: {} },
        prev: null,
        stash: {},
      } as unknown as AppSyncResolverEvent<Record<string, unknown>>;

      await expect(handler(event)).rejects.toThrow('UNAUTHORIZED: missing tenantId');
    });

    it('should succeed with valid tenantId and return data', async () => {
      const decision = { decisionId: 'd1', tenantId: 'tenant-1', status: 'PROPOSED' };
      mockSend.mockResolvedValueOnce({ Items: [decision] });

      const event = buildEvent('getDecision', { decisionId: 'd1' });

      const result = await handler(event);
      expect(result).toEqual(decision);
    });
  });
});
