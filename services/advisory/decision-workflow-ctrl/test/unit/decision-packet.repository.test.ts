/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
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
        KeyConditionExpression: skPrefix ? 'pk = :pk AND begins_with(sk, :sk)' : 'pk = :pk',
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
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  withMethodLogging: jest.fn().mockReturnValue((_name: string, fn: (...args: unknown[]) => unknown) => fn),
}));

process.env.TABLE_NAME = 'test-table';

import { DecisionPacketRepository } from '../../src/repositories/decision-packet.repository';

const TEST_CTX = { tenantId: 't1', userId: 'u1', region: 'us-east-1' };

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

describe('DecisionPacketRepository', () => {
  let repo: DecisionPacketRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new DecisionPacketRepository('test-table');
  });

  describe('createDecisionPacket', () => {
    it('should create a DecisionPacket with status INITIATED', async () => {
      mockSend.mockResolvedValueOnce({});

      const created = await repo.createDecisionPacket({
        decisionId: 'dp-1',
        trigger: 'MANDATE_CREATED',
        triggerEventId: 'evt-1',
        executionArn: 'arn:aws:states:us-east-1:123:execution:sm:exec-1',
      }, TEST_CTX as any);

      expect(created).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'DecisionPacket#t1#dp-1',
        sk: 'DecisionPacket',
        __typename: 'DecisionPacket',
        tenantId: 't1',
        userId: 'u1',
        region: 'us-east-1',
        decisionId: 'dp-1',
        status: 'INITIATED',
        trigger: 'MANDATE_CREATED',
        triggerEventId: 'evt-1',
        executionArn: 'arn:aws:states:us-east-1:123:execution:sm:exec-1',
      });
    });

    it('should return false when conditional write fails (duplicate)', async () => {
      const condError = new Error('Condition not met');
      condError.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(condError);

      const created = await repo.createDecisionPacket({
        decisionId: 'dp-dup',
        trigger: 'MANDATE_CREATED',
        triggerEventId: 'evt-dup',
        executionArn: null,
      }, TEST_CTX as any);
      expect(created).toBe(false);
    });
  });

  describe('getDecisionPacket', () => {
    it('should return packet when found', async () => {
      const dp = {
        pk: 'DecisionPacket#t1#dp-1',
        sk: 'DecisionPacket',
        __typename: 'DecisionPacket',
        tenantId: 't1',
        decisionId: 'dp-1',
        status: 'INITIATED',
      };
      mockSend.mockResolvedValueOnce({ Items: [dp] });

      const result = await repo.getDecisionPacket('t1', 'dp-1');
      expect(result).toEqual(dp);
    });

    it('should return null when not found', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      const result = await repo.getDecisionPacket('t1', 'dp-missing');
      expect(result).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('should update status via transactWrite without EditEvent', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateStatus('t1', 'dp-1', 'PROFILING');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems).toHaveLength(1);
      const attrs = extractUpdateAttrs(call.input.TransactItems[0].Update);
      expect(attrs).toMatchObject({ status: 'PROFILING' });
    });

    it('should merge extra details into the update', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateStatus('t1', 'dp-1', 'APPROVED', {
        authorityLevel: 'L1',
        complianceResult: 'APPROVED',
      });

      const call = mockSend.mock.calls[0][0];
      const attrs = extractUpdateAttrs(call.input.TransactItems[0].Update);
      expect(attrs).toMatchObject({
        status: 'APPROVED',
        authorityLevel: 'L1',
        complianceResult: 'APPROVED',
      });
    });
  });

});
