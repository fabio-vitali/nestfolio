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
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      try {
        await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item }));
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
import { DecisionRepository } from '../src/repositories/decision.repository';

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
        type: 'MANDATE_CREATED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {},
        context: { tenantId: 't1' },
      };

      const created = await repo.createDecisionPacket('t1', 'dp-1', triggerEvent as any, { tenantId: 't1' });

      expect(created).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'DecisionPacket#t1#dp-1',
        sk: 'DecisionPacket',
        __typename: 'DecisionPacket',
        tenantId: 't1',
        decisionId: 'dp-1',
        status: 'DRAFT',
        trigger: 'MANDATE_CREATED',
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
    it('should update status via transactWrite without EditEvent', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateDecisionStatus('t1', 'dp-1', 'AGENTS_COMPLETED', {
        agentOutputs: { test: true },
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems).toHaveLength(1);
      const updateItem = call.input.TransactItems[0].Update;
      expect(updateItem.Key).toEqual({ pk: 'DecisionPacket#t1#dp-1', sk: 'DecisionPacket' });
      const attrs = extractUpdateAttrs(updateItem);
      expect(attrs).toMatchObject({ status: 'AGENTS_COMPLETED', agentOutputs: { test: true } });
    });

    it('should use Update (not Put) to preserve existing attributes', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateDecisionStatus('t1', 'dp-1', 'PROPOSED');

      const call = mockSend.mock.calls[0][0];
      const firstItem = call.input.TransactItems[0];
      expect(firstItem.Update).toBeDefined();
      expect(firstItem.Put).toBeUndefined();
      const attrs = extractUpdateAttrs(firstItem.Update);
      expect(attrs).not.toHaveProperty('pk');
      expect(attrs).not.toHaveProperty('sk');
      expect(attrs).not.toHaveProperty('__typename');
      expect(attrs).not.toHaveProperty('decisionId');
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

  describe('createDecisionPacket — duplicate handling', () => {
    it('should return false when conditional write fails (duplicate)', async () => {
      const condError = new Error('Condition not met');
      condError.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(condError);

      const triggerEvent = {
        id: 'evt-dup',
        type: 'MANDATE_CREATED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {},
        context: { tenantId: 't1' },
      };

      const created = await repo.createDecisionPacket('t1', 'dp-dup', triggerEvent as any, { tenantId: 't1' });
      expect(created).toBe(false);
    });

    it('should propagate non-conditional DynamoDB errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('InternalServerError'));

      const triggerEvent = {
        id: 'evt-err',
        type: 'MANDATE_CREATED',
        timestamp: '2025-01-01T00:00:00.000Z',
        subject: {},
        context: { tenantId: 't1' },
      };

      await expect(
        repo.createDecisionPacket('t1', 'dp-err', triggerEvent as any, { tenantId: 't1' }),
      ).rejects.toThrow('InternalServerError');
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
