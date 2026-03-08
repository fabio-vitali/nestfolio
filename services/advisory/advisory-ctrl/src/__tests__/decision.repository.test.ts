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
    QueryCommand: jest.fn().mockImplementation((input) => ({ _type: 'Query', input })),
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

import { DecisionRepository } from '../repositories/decision.repository';

describe('DecisionRepository', () => {
  let repo: DecisionRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new DecisionRepository('test-table');
  });

  describe('createDecisionPacket', () => {
    it('should create a DecisionPacket with status DRAFT', async () => {
      mockSend.mockResolvedValueOnce({});

      const triggerEvent = {
        id: 'evt-1',
        type: 'MANDATE_GRANTED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {},
        context: { tenantId: 't1' },
      };

      await repo.createDecisionPacket('t1', 'dp-1', triggerEvent as any, { tenantId: 't1' });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'DecisionPacket#t1#dp-1',
        sk: 'DecisionPacket',
        __typename: 'DecisionPacket',
        tenantId: 't1',
        decisionId: 'dp-1',
        status: 'DRAFT',
        trigger: 'MANDATE_GRANTED',
      });
    });
  });

  describe('getDecisionPacket', () => {
    it('should return decision packet when found', async () => {
      const dp = {
        pk: 'DecisionPacket#t1#dp-1',
        sk: 'DecisionPacket',
        __typename: 'DecisionPacket',
        tenantId: 't1',
        decisionId: 'dp-1',
        status: 'DRAFT',
      };
      mockSend.mockResolvedValueOnce({ Items: [dp] });

      const result = await repo.getDecisionPacket('t1', 'dp-1');

      expect(result).toEqual(dp);
    });

    it('should return null when not found', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await repo.getDecisionPacket('t1', 'dp-not-found');

      expect(result).toBeNull();
    });
  });

  describe('updateDecisionStatus', () => {
    it('should update status with edit event in transaction', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateDecisionStatus('t1', 'dp-1', 'AGENTS_COMPLETED', {
        agentOutputs: { test: true },
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems).toHaveLength(2);
      expect(call.input.TransactItems[0].Put.Item).toMatchObject({
        pk: 'DecisionPacket#t1#dp-1',
        sk: 'DecisionPacket',
        __typename: 'DecisionPacket',
        status: 'AGENTS_COMPLETED',
      });
      expect(call.input.TransactItems[1].Put.Item).toMatchObject({
        __typename: 'EditEvent',
        operation: 'replace',
      });
    });
  });

  describe('recordAgentInvocation', () => {
    it('should create an AgentInvocation record', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.recordAgentInvocation('t1', 'dp-1', 1, 'user-goals', { input: true }, { output: true }, 42);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'DecisionPacket#t1#dp-1',
        sk: 'AgentInvocation#1#user-goals',
        __typename: 'AgentInvocation',
        agentName: 'user-goals',
        step: 1,
        latencyMs: 42,
        status: 'COMPLETED',
      });
    });
  });

  describe('recordReasoningOutput', () => {
    it('should create a ReasoningOutput record', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.recordReasoningOutput('t1', 'dp-1', 'risk-assessment', { riskScore: 0.45 });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'DecisionPacket#t1#dp-1',
        sk: 'ReasoningOutput#risk-assessment',
        __typename: 'ReasoningOutput',
        agentName: 'risk-assessment',
        output: { riskScore: 0.45 },
      });
    });
  });

  describe('createDecisionPacket — error paths', () => {
    it('should propagate DynamoDB errors with descriptive context', async () => {
      mockSend.mockRejectedValueOnce(new Error('ConditionalCheckFailedException'));

      const triggerEvent = {
        id: 'evt-err',
        type: 'MANDATE_GRANTED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {},
        context: { tenantId: 't1' },
      };

      await expect(
        repo.createDecisionPacket('t1', 'dp-err', triggerEvent as any, { tenantId: 't1' }),
      ).rejects.toThrow('ConditionalCheckFailedException');
    });
  });

  describe('updateWorkflowState', () => {
    it('should create a WorkflowState record', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateWorkflowState('t1', 'wf-1', { currentStep: 'risk-assessment', progress: 0.33 });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'Workflow#t1#wf-1',
        sk: 'WorkflowState',
        __typename: 'WorkflowState',
        tenantId: 't1',
        workflowId: 'wf-1',
        currentStep: 'risk-assessment',
        progress: 0.33,
      });
    });
  });
});
