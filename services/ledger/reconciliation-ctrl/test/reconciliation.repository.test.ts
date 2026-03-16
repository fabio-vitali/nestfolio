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
    DeleteCommand: jest.fn().mockImplementation((input) => ({ _type: 'Delete', input })),
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
      await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item }));
      return true;
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
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },

  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),

}));
import { ReconciliationRepository } from '../src/repositories/reconciliation.repository';

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

describe('ReconciliationRepository', () => {
  let repo: ReconciliationRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new ReconciliationRepository('test-table');
  });

  describe('createReconciliation', () => {
    it('should create a Reconciliation with status STARTED', async () => {
      mockSend.mockResolvedValueOnce({});

      const created = await repo.createReconciliation('t1', 'recon-1', 'MANUAL');

      expect(created).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'Reconciliation#t1#recon-1',
        sk: 'Reconciliation',
        __typename: 'Reconciliation',
        tenantId: 't1',
        reconciliationId: 'recon-1',
        sourceEventId: 'recon-1',
        triggerType: 'MANUAL',
        status: 'STARTED',
      });
    });
  });

  describe('getReconciliation', () => {
    it('should return reconciliation when found', async () => {
      const recon = {
        pk: 'Reconciliation#t1#recon-1',
        sk: 'Reconciliation',
        __typename: 'Reconciliation',
        status: 'STARTED',
      };
      mockSend.mockResolvedValueOnce({ Items: [recon] });

      const result = await repo.getReconciliation('t1', 'recon-1');

      expect(result).toEqual(recon);
    });

    it('should return null when not found', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await repo.getReconciliation('t1', 'recon-not-found');

      expect(result).toBeNull();
    });
  });

  describe('updateReconciliationStatus', () => {
    it('should update status with edit event in transaction', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateReconciliationStatus('t1', 'recon-1', 'COMPLETED');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems).toHaveLength(2);
      const updateItem = call.input.TransactItems[0].Update;
      expect(updateItem.Key).toEqual({ pk: 'Reconciliation#t1#recon-1', sk: 'Reconciliation' });
      const attrs = extractUpdateAttrs(updateItem);
      expect(attrs).toMatchObject({ status: 'COMPLETED', completedAt: '2025-01-01T00:00:00.000Z' });
      expect(call.input.TransactItems[1].Put.Item).toMatchObject({
        __typename: 'EditEvent',
        operation: 'replace',
      });
    });

    it('should use Update (not Put) to preserve existing attributes', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateReconciliationStatus('t1', 'recon-1', 'COMPLETED');

      const call = mockSend.mock.calls[0][0];
      const firstItem = call.input.TransactItems[0];
      expect(firstItem.Update).toBeDefined();
      expect(firstItem.Put).toBeUndefined();
      const attrs = extractUpdateAttrs(firstItem.Update);
      expect(attrs).not.toHaveProperty('pk');
      expect(attrs).not.toHaveProperty('sk');
      expect(attrs).not.toHaveProperty('__typename');
      expect(attrs).not.toHaveProperty('reconciliationId');
    });
  });

  describe('createDriftRecord', () => {
    it('should create a DriftRecord', async () => {
      mockSend.mockResolvedValueOnce({});

      const created = await repo.createDriftRecord('t1', 'recon-1', 'AAPL', 100, 95, 5);

      expect(created).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'Reconciliation#t1#recon-1',
        sk: 'DriftRecord#AAPL',
        __typename: 'DriftRecord',
        sourceEventId: 'recon-1-AAPL',
        instrument: 'AAPL',
        intentQty: 100,
        settlementQty: 95,
        drift: 5,
      });
    });
  });

  describe('getDriftRecords', () => {
    it('should return all drift records for a reconciliation', async () => {
      const drifts = [
        { instrument: 'AAPL', drift: 5 },
        { instrument: 'MSFT', drift: -3 },
      ];
      mockSend.mockResolvedValueOnce({ Items: drifts });

      const result = await repo.getDriftRecords('t1', 'recon-1');

      expect(result).toEqual(drifts);
    });
  });

  describe('acquireLock', () => {
    it('should acquire lock when not locked', async () => {
      mockSend.mockResolvedValueOnce({});

      const acquired = await repo.acquireLock('t1');

      expect(acquired).toBe(true);
    });

    it('should return false when lock exists', async () => {
      const error = new Error('ConditionalCheckFailedException');
      (error as any).name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(error);

      const acquired = await repo.acquireLock('t1');

      expect(acquired).toBe(false);
    });
  });

  describe('releaseLock', () => {
    it('should delete the lock item', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.releaseLock('t1');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Key).toEqual({
        pk: 'ReconciliationLock#t1',
        sk: 'ReconciliationLock',
      });
    });
  });

  describe('createReconciliation — error paths', () => {
    it('should propagate DynamoDB errors on create', async () => {
      mockSend.mockRejectedValueOnce(new Error('ProvisionedThroughputExceededException'));

      await expect(
        repo.createReconciliation('t1', 'recon-err', 'MANUAL'),
      ).rejects.toThrow('ProvisionedThroughputExceededException');
    });
  });

  describe('isLocked', () => {
    it('should return true when lock exists and not expired', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { expiresAt: Date.now() + 60000 },
      });

      const locked = await repo.isLocked('t1');

      expect(locked).toBe(true);
    });

    it('should return false when no lock exists', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const locked = await repo.isLocked('t1');

      expect(locked).toBe(false);
    });

    it('should return false when lock is expired', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { expiresAt: Date.now() - 60000 },
      });

      const locked = await repo.isLocked('t1');

      expect(locked).toBe(false);
    });
  });
});
