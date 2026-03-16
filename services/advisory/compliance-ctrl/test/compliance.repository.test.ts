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
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      try {
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

  EntityNotFoundError: class EntityNotFoundError extends Error {
    constructor(public entityType: string, public entityId: string) {
      super(`${entityType} with id '${entityId}' not found`);
      this.name = 'EntityNotFoundError';
    }
  },

}));
import { ComplianceRepository } from '../src/repositories/compliance.repository';

describe('ComplianceRepository', () => {
  let repo: ComplianceRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new ComplianceRepository('test-table');
  });

  describe('createComplianceCheck', () => {
    it('should create a ComplianceCheck with PENDING status and return true', async () => {
      mockSend.mockResolvedValueOnce({});

      const created = await repo.createComplianceCheck('t-1', 'cc-1', 'dp-1', {
        mandateId: 'm-1',
        level: 'DISCRETIONARY',
        monthlyTurnoverCapPercent: 10,
        maxSingleTradePercent: 5,
        effectiveDate: '2024-01-01T00:00:00.000Z',
        revokedAt: null,
      });

      expect(created).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'ComplianceCheck#t-1#cc-1',
        sk: 'ComplianceCheck',
        __typename: 'ComplianceCheck',
        tenantId: 't-1',
        ccId: 'cc-1',
        decisionPacketId: 'dp-1',
        status: 'PENDING',
      });
    });

    it('should return false when item already exists', async () => {
      mockSend.mockRejectedValueOnce(Object.assign(new Error('ConditionalCheckFailedException'), { name: 'ConditionalCheckFailedException' }));

      const created = await repo.createComplianceCheck('t-1', 'cc-1', 'dp-1', {
        mandateId: 'm-1',
        level: 'DISCRETIONARY',
        monthlyTurnoverCapPercent: 10,
        maxSingleTradePercent: 5,
        effectiveDate: '2024-01-01T00:00:00.000Z',
        revokedAt: null,
      });

      expect(created).toBe(false);
    });
  });

  describe('getComplianceCheck', () => {
    it('should return check when found', async () => {
      const check = {
        pk: 'ComplianceCheck#t-1#cc-1',
        sk: 'ComplianceCheck',
        __typename: 'ComplianceCheck',
        tenantId: 't-1',
        ccId: 'cc-1',
      };
      mockSend.mockResolvedValueOnce({ Item: check });

      const result = await repo.getComplianceCheck('t-1', 'cc-1');

      expect(result).toEqual(check);
    });

    it('should throw EntityNotFoundError when not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      await expect(repo.getComplianceCheck('t-1', 'cc-1')).rejects.toThrow('not found');
    });
  });

  describe('updateCheckResult', () => {
    it('should update check with result and create edit event', async () => {
      const updated = {
        pk: 'ComplianceCheck#t-1#cc-1',
        sk: 'ComplianceCheck',
        status: 'COMPLETED',
        result: 'APPROVED',
      };
      mockSend.mockResolvedValueOnce({ Attributes: updated }); // UpdateCommand
      mockSend.mockResolvedValueOnce({}); // EditEvent put

      const result = await repo.updateCheckResult('t-1', 'cc-1', 'APPROVED', [], 'L1');

      expect(result).toMatchObject({ result: 'APPROVED' });
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should throw when check not found on update', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: undefined });

      await expect(
        repo.updateCheckResult('t-1', 'cc-1', 'BLOCKED', [], 'L2'),
      ).rejects.toThrow('not found');
    });
  });

  describe('createAuditArtifact', () => {
    it('should create an AuditArtifact record and return true', async () => {
      mockSend.mockResolvedValueOnce({});

      const created = await repo.createAuditArtifact('t-1', 'cc-1', 'aa-1', {
        decisionPacketId: 'dp-1',
        evaluatedAt: '2025-01-01T00:00:00.000Z',
      });

      expect(created).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'ComplianceCheck#t-1#cc-1',
        sk: 'AuditArtifact#aa-1',
        __typename: 'AuditArtifact',
        tenantId: 't-1',
        artifactId: 'aa-1',
      });
    });
  });

  describe('putMandateSnapshot', () => {
    it('should store mandate snapshot', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.putMandateSnapshot('t-1', 'u-1', {
        mandateId: 'm-1',
        level: 'DISCRETIONARY',
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'GuardrailPolicy#t-1#u-1',
        sk: 'MandateSnapshot',
        __typename: 'MandateSnapshot',
        tenantId: 't-1',
        mandateId: 'm-1',
      });
    });
  });

  describe('getMandateSnapshot', () => {
    it('should return mandate snapshot when found', async () => {
      const snapshot = {
        pk: 'GuardrailPolicy#t-1#u-1',
        sk: 'MandateSnapshot',
        mandateId: 'm-1',
      };
      mockSend.mockResolvedValueOnce({ Item: snapshot });

      const result = await repo.getMandateSnapshot('t-1', 'u-1');

      expect(result).toEqual(snapshot);
    });

    it('should return null when mandate snapshot not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await repo.getMandateSnapshot('t-1', 'u-1');

      expect(result).toBeNull();
    });
  });

  describe('getGuardrailPolicy', () => {
    it('should return guardrail policy when found', async () => {
      const policy = {
        pk: 'GuardrailPolicy#t-1#u-1',
        sk: 'GuardrailPolicy',
        maxSingleTradePercent: 5,
      };
      mockSend.mockResolvedValueOnce({ Item: policy });

      const result = await repo.getGuardrailPolicy('t-1', 'u-1');

      expect(result).toEqual(policy);
    });

    it('should return null when guardrail policy not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await repo.getGuardrailPolicy('t-1', 'u-1');

      expect(result).toBeNull();
    });
  });
});
