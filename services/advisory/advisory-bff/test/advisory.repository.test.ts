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
    protected async putIfNotExists(item: Record<string, unknown>): Promise<boolean> {
      try {
        const { PutCommand } = require('@aws-sdk/lib-dynamodb');
        await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item, ConditionExpression: 'attribute_not_exists(pk)' }));
        return true;
      } catch (err: any) {
        if (err.name === 'ConditionalCheckFailedException') return false;
        throw err;
      }
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
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },

  withMethodLogging: () => (_name: string, fn: (...args: unknown[]) => unknown) => fn,

}));
import { AdvisoryRepository } from '../src/repositories/advisory.repository';

function extractUpdateAttrs(update: any): Record<string, unknown> {
  const names = update.ExpressionAttributeNames;
  const values = update.ExpressionAttributeValues;
  const result: Record<string, unknown> = {};
  for (const [nameKey, attrName] of Object.entries(names)) {
    const idx = nameKey.replace('#a', '');
    result[attrName as string] = values[`:v${idx}`];
  }
  return result;
}

describe('AdvisoryRepository', () => {
  let repo: AdvisoryRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new AdvisoryRepository('test-table');
  });

  describe('storeDecision', () => {
    it('should store a decision read model', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await repo.storeDecision('t1', 'd1', {
        trigger: 'REBALANCE',
        explanation: 'Rebalance needed',
        proposedTrades: [],
        confirmationRequired: true,
      });

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'Decision#t1#d1',
        sk: 'DecisionReadModel',
        __typename: 'DecisionReadModel',
        tenantId: 't1',
        decisionId: 'd1',
        status: 'PROPOSED',
        trigger: 'REBALANCE',
      });
      expect(call.input.ConditionExpression).toBe('attribute_not_exists(pk)');
    });
  });

  describe('getDecision', () => {
    it('should return decision when found', async () => {
      const decision = {
        pk: 'Decision#t1#d1',
        sk: 'DecisionReadModel',
        __typename: 'DecisionReadModel',
        decisionId: 'd1',
        status: 'PROPOSED',
      };
      mockSend.mockResolvedValueOnce({ Items: [decision] });

      const result = await repo.getDecision('t1', 'd1');

      expect(result).toEqual(decision);
    });

    it('should return null when not found', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await repo.getDecision('t1', 'd1');

      expect(result).toBeNull();
    });
  });

  describe('updateDecisionStatus', () => {
    it('should update status via transactWrite', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateDecisionStatus('t1', 'd1', 'APPROVED');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems).toHaveLength(1);
      const updateItem = call.input.TransactItems[0].Update;
      expect(updateItem.Key).toEqual({ pk: 'Decision#t1#d1', sk: 'DecisionReadModel' });
      const attrs = extractUpdateAttrs(updateItem);
      expect(attrs).toMatchObject({ status: 'APPROVED' });
    });

    it('should use Update (not Put) to preserve existing attributes', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateDecisionStatus('t1', 'd1', 'APPROVED');

      const call = mockSend.mock.calls[0][0];
      const firstItem = call.input.TransactItems[0];
      expect(firstItem.Update).toBeDefined();
      expect(firstItem.Put).toBeUndefined();
      const attrs = extractUpdateAttrs(firstItem.Update);
      expect(attrs).not.toHaveProperty('pk');
      expect(attrs).not.toHaveProperty('sk');
      expect(attrs).not.toHaveProperty('__typename');
    });
  });

  describe('storeAgentInvocation', () => {
    it('should store an agent invocation record', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.storeAgentInvocation('t1', 'd1', {
        invocationId: 'inv-1',
        agentName: 'rebalance-agent',
        modelId: 'claude-v3',
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 500,
        status: 'COMPLETED',
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'Decision#t1#d1',
        sk: 'AgentInvocation#inv-1',
        __typename: 'AgentInvocation',
        agentName: 'rebalance-agent',
      });
    });
  });

  describe('getComplianceChecks', () => {
    it('should return compliance checks for a decision', async () => {
      const checks = [
        { checkId: 'c1', ruleName: 'concentration-limit', result: 'PASSED' },
        { checkId: 'c2', ruleName: 'sector-exposure', result: 'PASSED' },
      ];
      mockSend.mockResolvedValueOnce({ Items: checks });

      const result = await repo.getComplianceChecks('t1', 'd1');

      expect(result).toEqual(checks);
    });
  });

  describe('recordUserInteraction', () => {
    it('should store a user interaction record', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.recordUserInteraction('t1', 'u1', 'd1', 'VIEWED_EXPLANATION');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'Decision#t1#d1',
        sk: 'UserInteraction#test-uuid',
        __typename: 'UserInteraction',
        userId: 'u1',
        interactionType: 'VIEWED_EXPLANATION',
      });
    });
  });

  describe('putUserConfirmation', () => {
    it('should store a UserConfirmation record for Egress CDC', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.putUserConfirmation('t1', 'd1', 'u1', '2025-01-01T00:00:00.000Z');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'Decision#t1#d1',
        sk: 'UserConfirmation#test-uuid',
        __typename: 'UserConfirmation',
        tenantId: 't1',
        decisionId: 'd1',
        userId: 'u1',
        confirmedAt: '2025-01-01T00:00:00.000Z',
      });
    });
  });

  describe('putUserRejection', () => {
    it('should store a UserRejection record for Egress CDC', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.putUserRejection('t1', 'd1', 'u1', '2025-01-01T00:00:00.000Z', 'Too risky');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'Decision#t1#d1',
        sk: 'UserRejection#test-uuid',
        __typename: 'UserRejection',
        tenantId: 't1',
        decisionId: 'd1',
        userId: 'u1',
        rejectedAt: '2025-01-01T00:00:00.000Z',
        rejectionReason: 'Too risky',
      });
    });
  });
});
