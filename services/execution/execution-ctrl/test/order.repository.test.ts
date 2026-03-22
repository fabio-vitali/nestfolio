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
    DeleteCommand: jest.fn().mockImplementation((input) => ({ _type: 'Delete', input })),
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
      await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item, ConditionExpression: 'attribute_not_exists(pk)' }));
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
    protected async queryAll(input: unknown) {
      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const result = await this.docClient.send(new QueryCommand(input));
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
import { OrderRepository } from '../src/repositories/order.repository';

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

describe('OrderRepository', () => {
  let repo: OrderRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new OrderRepository('test-table');
  });

  describe('createOrder', () => {
    it('should create an Order with status PENDING using conditional write', async () => {
      mockSend.mockResolvedValueOnce({});

      const trades = [
        { symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY' as const, quantityOrAmountCents: 10, targetWeightPercent: 50, rationale: 'Buy VTI' },
      ];

      const result = await repo.createOrder('t1', 'ord-1', 'dp-1', trades, 'evt-1');

      expect(result).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'Order#t1#ord-1',
        sk: 'Order',
        __typename: 'Order',
        tenantId: 't1',
        orderId: 'ord-1',
        decisionPacketId: 'dp-1',
        status: 'PENDING',
        proposedTrades: trades,
        sourceEventId: 'evt-1',
      });
    });
  });

  describe('getOrder', () => {
    it('should return order when found', async () => {
      const order = {
        pk: 'Order#t1#ord-1',
        sk: 'Order',
        __typename: 'Order',
        tenantId: 't1',
        orderId: 'ord-1',
        status: 'PENDING',
      };
      mockSend.mockResolvedValueOnce({ Items: [order] });

      const result = await repo.getOrder('t1', 'ord-1');

      expect(result).toEqual(order);
    });

    it('should return null when not found', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await repo.getOrder('t1', 'ord-not-found');

      expect(result).toBeNull();
    });
  });

  describe('updateOrderStatus', () => {
    it('should update status via transactWrite without EditEvent', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateOrderStatus('t1', 'ord-1', 'SUBMITTED');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems).toHaveLength(1);
      const updateItem = call.input.TransactItems[0].Update;
      expect(updateItem.Key).toEqual({ pk: 'Order#t1#ord-1', sk: 'Order' });
      const attrs = extractUpdateAttrs(updateItem);
      expect(attrs).toMatchObject({ status: 'SUBMITTED' });
    });

    it('should include details when rejecting', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateOrderStatus('t1', 'ord-1', 'REJECTED', { reason: 'Safety check failed' });

      const call = mockSend.mock.calls[0][0];
      const attrs = extractUpdateAttrs(call.input.TransactItems[0].Update);
      expect(attrs).toMatchObject({
        status: 'REJECTED',
        reason: 'Safety check failed',
      });
    });

    it('should use Update (not Put) to preserve existing attributes', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateOrderStatus('t1', 'ord-1', 'SUBMITTED');

      const call = mockSend.mock.calls[0][0];
      const firstItem = call.input.TransactItems[0];
      expect(firstItem.Update).toBeDefined();
      expect(firstItem.Put).toBeUndefined();
      const attrs = extractUpdateAttrs(firstItem.Update);
      expect(attrs).not.toHaveProperty('pk');
      expect(attrs).not.toHaveProperty('sk');
      expect(attrs).not.toHaveProperty('__typename');
      expect(attrs).not.toHaveProperty('orderId');
    });
  });

  describe('createStagedOrder', () => {
    it('should create a StagedOrder record', async () => {
      mockSend.mockResolvedValueOnce({});

      const trades = [{ symbol: 'VTI', side: 'BUY', quantityOrAmountCents: 10 }];
      await repo.createStagedOrder('t1', 'ord-1', { proposedTrades: trades });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'StagedOrder#t1#ord-1',
        sk: 'StagedOrder',
        __typename: 'StagedOrder',
        tenantId: 't1',
        orderId: 'ord-1',
      });
    });
  });

  describe('getStagedOrders', () => {
    it('should query staged orders using GSI', async () => {
      const staged = [
        { pk: 'StagedOrder#t1#ord-1', sk: 'StagedOrder', __typename: 'StagedOrder', tenantId: 't1', orderId: 'ord-1' },
      ];
      mockSend.mockResolvedValueOnce({ Items: staged });

      const result = await repo.getStagedOrders('t1');

      expect(result).toEqual(staged);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.IndexName).toBe('tenantId-index');
    });
  });

  describe('deleteStagedOrder', () => {
    it('should delete a staged order', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.deleteStagedOrder('t1', 'ord-1');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Key).toEqual({
        pk: 'StagedOrder#t1#ord-1',
        sk: 'StagedOrder',
      });
    });
  });

  describe('setCoolDown', () => {
    it('should create a CoolDown record', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.setCoolDown('t1', 'VTI', '2025-01-02T00:00:00.000Z');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'CoolDown#t1#VTI',
        sk: 'CoolDown',
        __typename: 'CoolDown',
        tenantId: 't1',
        instrument: 'VTI',
        expiresAt: '2025-01-02T00:00:00.000Z',
      });
    });
  });

  describe('getCoolDown', () => {
    it('should return cooldown when found', async () => {
      const cd = {
        pk: 'CoolDown#t1#VTI',
        sk: 'CoolDown',
        __typename: 'CoolDown',
        tenantId: 't1',
        instrument: 'VTI',
        expiresAt: '2025-01-02T00:00:00.000Z',
      };
      mockSend.mockResolvedValueOnce({ Items: [cd] });

      const result = await repo.getCoolDown('t1', 'VTI');

      expect(result).toEqual(cd);
    });

    it('should return null when no cooldown', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await repo.getCoolDown('t1', 'AAPL');

      expect(result).toBeNull();
    });
  });

  describe('createOrder — error paths', () => {
    it('should propagate DynamoDB errors on create', async () => {
      mockSend.mockRejectedValueOnce(new Error('ProvisionedThroughputExceededException'));

      const trades = [
        { symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY' as const, quantityOrAmountCents: 10, targetWeightPercent: 50, rationale: 'Buy VTI' },
      ];

      await expect(
        repo.createOrder('t1', 'ord-err', 'dp-1', trades),
      ).rejects.toThrow('ProvisionedThroughputExceededException');
    });

    it('should propagate TransactWriteItems error on status update', async () => {
      mockSend.mockRejectedValueOnce(new Error('TransactionCanceledException'));

      await expect(
        repo.updateOrderStatus('t1', 'ord-err', 'SUBMITTED'),
      ).rejects.toThrow('TransactionCanceledException');
    });
  });

  describe('getConflictingStagedOrders', () => {
    it('should return staged orders with conflicting instruments', async () => {
      const staged = [
        {
          pk: 'StagedOrder#t1#ord-1',
          sk: 'StagedOrder',
          __typename: 'StagedOrder',
          tenantId: 't1',
          orderId: 'ord-1',
          proposedTrades: [{ symbol: 'VTI', side: 'BUY', quantityOrAmountCents: 10 }],
        },
        {
          pk: 'StagedOrder#t1#ord-2',
          sk: 'StagedOrder',
          __typename: 'StagedOrder',
          tenantId: 't1',
          orderId: 'ord-2',
          proposedTrades: [{ symbol: 'BND', side: 'BUY', quantityOrAmountCents: 5 }],
        },
      ];
      mockSend.mockResolvedValueOnce({ Items: staged });

      const result = await repo.getConflictingStagedOrders('t1', ['VTI']);

      expect(result).toHaveLength(1);
      expect((result[0] as any).orderId).toBe('ord-1');
    });

    it('should return empty when no conflicts', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await repo.getConflictingStagedOrders('t1', ['AAPL']);

      expect(result).toHaveLength(0);
    });
  });
});
