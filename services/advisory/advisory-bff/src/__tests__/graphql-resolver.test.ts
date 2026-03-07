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
  },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('@nestfolio/lambda-utils', () => ({}));
jest.mock('@nestfolio/domain-core', () => ({}));

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

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/graphql-resolver');
      const result = await handler(event);
      expect(result).toEqual(decision);
    });
  });

  it('should resolve getPendingDecisions', async () => {
    const decisions = [
      { decisionId: 'd1', status: 'PROPOSED' },
      { decisionId: 'd2', status: 'APPROVED' },
    ];
    mockSend.mockResolvedValueOnce({ Items: decisions });

    const event = buildEvent('getPendingDecisions', { limit: 10 });

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/graphql-resolver');
      const result = await handler(event);
      expect(result.items).toEqual(decisions);
    });
  });

  it('should resolve confirmDecision', async () => {
    // transactWrite for updateDecisionStatus
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

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/graphql-resolver');
      const result = await handler(event);
      expect(result).toMatchObject({ status: 'CONFIRMED' });
    });
  });

  it('should resolve rejectDecision', async () => {
    // transactWrite for updateDecisionStatus
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

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/graphql-resolver');
      const result = await handler(event);
      expect(result).toMatchObject({ status: 'REJECTED', rejectionReason: 'Too risky' });
    });
  });

  it('should resolve recordExplanationView', async () => {
    // put for recordUserInteraction
    mockSend.mockResolvedValueOnce({});

    const event = buildEvent('recordExplanationView', { decisionId: 'd1' });

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../handlers/graphql-resolver');
      const result = await handler(event);
      expect(result).toEqual({
        decisionId: 'd1',
        viewedAt: '2025-01-01T00:00:00.000Z',
      });
    });
  });
});
