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
    protected async queryAll(input: unknown) {
      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const result = await this.docClient.send(new QueryCommand(input));
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

import { OrderRepository } from '../repositories/order.repository';

describe('OrderRepository', () => {
  let repo: OrderRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new OrderRepository('test-table');
  });

  describe('createOrder', () => {
    it('should create an Order with status PENDING', async () => {
      mockSend.mockResolvedValueOnce({});

      const trades = [
        { symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY' as const, quantityOrAmountCents: 10, targetWeightPercent: 50, rationale: 'Buy VTI' },
      ];

      await repo.createOrder('t1', 'ord-1', 'dp-1', trades);

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
    it('should update status with edit event in transaction', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateOrderStatus('t1', 'ord-1', 'SUBMITTED');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems).toHaveLength(2);
      expect(call.input.TransactItems[0].Put.Item).toMatchObject({
        pk: 'Order#t1#ord-1',
        sk: 'Order',
        __typename: 'Order',
        status: 'SUBMITTED',
      });
      expect(call.input.TransactItems[1].Put.Item).toMatchObject({
        __typename: 'EditEvent',
        operation: 'replace',
      });
    });

    it('should include details when rejecting', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateOrderStatus('t1', 'ord-1', 'REJECTED', { reason: 'Safety check failed' });

      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems[0].Put.Item).toMatchObject({
        status: 'REJECTED',
        reason: 'Safety check failed',
      });
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
