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

jest.mock('@nestfolio/domain-core', () => ({}));

import { AdvisoryRepository } from '../repositories/advisory.repository';

describe('AdvisoryRepository', () => {
  let repo: AdvisoryRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new AdvisoryRepository('test-table');
  });

  describe('storeDecision', () => {
    it('should store a decision read model', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.storeDecision('t1', 'd1', {
        trigger: 'REBALANCE',
        explanation: 'Rebalance needed',
        proposedTrades: [],
        confirmationRequired: true,
      });

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
      expect(call.input.TransactItems).toHaveLength(2);
      expect(call.input.TransactItems[0].Put.Item).toMatchObject({
        pk: 'Decision#t1#d1',
        sk: 'DecisionReadModel',
        __typename: 'DecisionReadModel',
        status: 'APPROVED',
      });
      expect(call.input.TransactItems[1].Put.Item).toMatchObject({
        __typename: 'EditEvent',
        operation: 'replace',
      });
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
});
