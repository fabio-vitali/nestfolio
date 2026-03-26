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
import { VirtualLedgerRepository } from '../src/repositories/virtual-ledger.repository';

describe('VirtualLedgerRepository', () => {
  let repo: VirtualLedgerRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new VirtualLedgerRepository('test-table');
  });

  describe('getCashBalance', () => {
    it('should return cash balance when found', async () => {
      const balance = {
        pk: 'VirtualLedger#t-1#u-1',
        sk: 'CashBalance#USD',
        __typename: 'VirtualCashBalance',
        balance: 100000,
      };
      mockSend.mockResolvedValueOnce({ Item: balance });

      const result = await repo.getCashBalance('t-1', 'u-1', 'USD');

      expect(result).toEqual(balance);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Key).toEqual({
        pk: 'VirtualLedger#t-1#u-1',
        sk: 'CashBalance#USD',
      });
    });

    it('should return null when not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await repo.getCashBalance('t-1', 'u-1', 'USD');

      expect(result).toBeNull();
    });
  });

  describe('initializeCashBalance', () => {
    it('should create a VirtualCashBalance record', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.initializeCashBalance('t-1', 'u-1', 'USD', 100000);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'VirtualLedger#t-1#u-1',
        sk: 'CashBalance#USD',
        __typename: 'VirtualCashBalance',
        tenantId: 't-1',
        userId: 'u-1',
        currency: 'USD',
        balance: 100000,
      });
    });

    it('should set version to 1 for new cash balances', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.initializeCashBalance('t-1', 'u-1', 'EUR', 50000);

      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item.version).toBe(1);
    });
  });

  describe('updateCashBalanceConditional', () => {
    it('should use PutCommand with ConditionExpression for optimistic locking', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateCashBalanceConditional('t-1', 'u-1', 'USD', 95000, 3);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call._type).toBe('Put');
      expect(call.input.Item).toMatchObject({
        pk: 'VirtualLedger#t-1#u-1',
        sk: 'CashBalance#USD',
        __typename: 'VirtualCashBalance',
        balance: 95000,
        version: 4,
      });
      expect(call.input.ConditionExpression).toBe('#v = :expectedVersion');
      expect(call.input.ExpressionAttributeNames).toEqual({ '#v': 'version' });
      expect(call.input.ExpressionAttributeValues).toEqual({ ':expectedVersion': 3 });
    });

    it('should increment version by 1', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateCashBalanceConditional('t-1', 'u-1', 'USD', 80000, 5);

      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item.version).toBe(6);
    });
  });

  describe('getPosition', () => {
    it('should return position when found', async () => {
      const position = {
        pk: 'VirtualLedger#t-1#u-1',
        sk: 'Position#VTI',
        __typename: 'VirtualPosition',
        symbol: 'VTI',
        quantity: 10,
      };
      mockSend.mockResolvedValueOnce({ Item: position });

      const result = await repo.getPosition('t-1', 'u-1', 'VTI');

      expect(result).toEqual(position);
    });

    it('should return null when not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await repo.getPosition('t-1', 'u-1', 'VTI');

      expect(result).toBeNull();
    });
  });

  describe('getAllPositions', () => {
    it('should return all positions for a user', async () => {
      const positions = [
        { pk: 'VirtualLedger#t-1#u-1', sk: 'Position#VTI', symbol: 'VTI', quantity: 10 },
        { pk: 'VirtualLedger#t-1#u-1', sk: 'Position#BND', symbol: 'BND', quantity: 20 },
      ];
      mockSend.mockResolvedValueOnce({ Items: positions });

      const result = await repo.getAllPositions('t-1', 'u-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ symbol: 'VTI' });
      expect(result[1]).toMatchObject({ symbol: 'BND' });
    });

    it('should return empty array when no positions exist', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await repo.getAllPositions('t-1', 'u-1');

      expect(result).toHaveLength(0);
    });
  });

  describe('executeTrade', () => {
    it('should execute a BUY trade atomically with TransactWriteItems', async () => {
      // getCashBalance call for version read
      mockSend.mockResolvedValueOnce({ Item: { balance: 100000, version: 2 } });
      // getPosition call returns null (no existing position)
      mockSend.mockResolvedValueOnce({ Item: undefined });
      // transactWrite
      mockSend.mockResolvedValueOnce({});

      await repo.executeTrade('t-1', 'u-1', {
        tradeId: 'trade-1',
        orderId: 'order-1',
        symbol: 'VTI',
        side: 'BUY',
        quantity: 10,
        fillPrice: 250.50,
        totalValue: 2505,
        cashBefore: 100000,
        cashAfter: 97495,
      });

      expect(mockSend).toHaveBeenCalledTimes(3);
      const transactCall = mockSend.mock.calls[2][0];
      const items = transactCall.input.TransactItems;
      expect(items).toHaveLength(3);

      // Cash update with version-based optimistic locking
      expect(items[0].Put.Item).toMatchObject({
        __typename: 'VirtualCashBalance',
        balance: 97495,
        version: 3,
      });
      expect(items[0].Put.ConditionExpression).toBe('#v = :expectedVersion');
      expect(items[0].Put.ExpressionAttributeNames).toEqual({ '#v': 'version' });
      expect(items[0].Put.ExpressionAttributeValues).toEqual({ ':expectedVersion': 2 });

      // Position update
      expect(items[1].Put.Item).toMatchObject({
        __typename: 'VirtualPosition',
        symbol: 'VTI',
        quantity: 10,
      });

      // Trade record
      expect(items[2].Put.Item).toMatchObject({
        __typename: 'VirtualTrade',
        tradeId: 'trade-1',
        orderId: 'order-1',
        side: 'BUY',
      });
    });

    it('should use attribute_not_exists when no prior cash balance exists', async () => {
      // getCashBalance returns null (no existing cash)
      mockSend.mockResolvedValueOnce({ Item: undefined });
      // getPosition returns null
      mockSend.mockResolvedValueOnce({ Item: undefined });
      // transactWrite
      mockSend.mockResolvedValueOnce({});

      await repo.executeTrade('t-1', 'u-1', {
        tradeId: 'trade-new',
        orderId: 'order-new',
        symbol: 'VTI',
        side: 'BUY',
        quantity: 5,
        fillPrice: 100,
        totalValue: 500,
        cashBefore: 0,
        cashAfter: -500,
      });

      const transactCall = mockSend.mock.calls[2][0];
      const cashPut = transactCall.input.TransactItems[0].Put;
      expect(cashPut.Item.version).toBe(1);
      expect(cashPut.ConditionExpression).toBe('attribute_not_exists(#v)');
      expect(cashPut.ExpressionAttributeNames).toEqual({ '#v': 'version' });
      expect(cashPut.ExpressionAttributeValues).toBeUndefined();
    });

    it('should execute a SELL trade and reduce position', async () => {
      // getCashBalance call for version read
      mockSend.mockResolvedValueOnce({ Item: { balance: 50000, version: 1 } });
      // getPosition returns existing position
      mockSend.mockResolvedValueOnce({
        Item: { quantity: 20, averageCostBasis: 240 },
      });
      // transactWrite
      mockSend.mockResolvedValueOnce({});

      await repo.executeTrade('t-1', 'u-1', {
        tradeId: 'trade-2',
        orderId: 'order-2',
        symbol: 'VTI',
        side: 'SELL',
        quantity: 5,
        fillPrice: 250.50,
        totalValue: 1252.50,
        cashBefore: 50000,
        cashAfter: 51252.50,
      });

      expect(mockSend).toHaveBeenCalledTimes(3);
      const transactCall = mockSend.mock.calls[2][0];
      const positionItem = transactCall.input.TransactItems[1].Put.Item;
      expect(positionItem.quantity).toBe(15);
      expect(positionItem.averageCostBasis).toBe(240); // preserves cost basis on sell
    });
  });

  describe('getTradeHistory', () => {
    it('should return trades in reverse chronological order', async () => {
      const trades = [
        { sk: 'Trade#2025-01-02#t2', symbol: 'BND' },
        { sk: 'Trade#2025-01-01#t1', symbol: 'VTI' },
      ];
      mockSend.mockResolvedValueOnce({ Items: trades });

      const result = await repo.getTradeHistory('t-1', 'u-1');

      expect(result).toHaveLength(2);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.ScanIndexForward).toBe(false);
    });

    it('should respect limit parameter', async () => {
      mockSend.mockResolvedValueOnce({ Items: [{ sk: 'Trade#2025-01-01#t1' }] });

      await repo.getTradeHistory('t-1', 'u-1', 1);

      const call = mockSend.mock.calls[0][0];
      expect(call.input.Limit).toBe(1);
    });
  });

  describe('createSnapshot', () => {
    it('should create a VirtualSnapshot record', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.createSnapshot('t-1', 'u-1', {
        date: '2025-01-01',
        cashBalance: 95000,
        positions: [{ symbol: 'VTI', quantity: 10, marketValue: 2505 }],
        totalValue: 97505,
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'VirtualLedger#t-1#u-1',
        sk: 'Snapshot#2025-01-01',
        __typename: 'VirtualSnapshot',
        tenantId: 't-1',
        totalValue: 97505,
      });
    });
  });

  describe('getLatestSnapshot', () => {
    it('should return the most recent snapshot', async () => {
      const snapshot = {
        pk: 'VirtualLedger#t-1#u-1',
        sk: 'Snapshot#2025-01-02',
        totalValue: 98000,
      };
      mockSend.mockResolvedValueOnce({ Items: [snapshot] });

      const result = await repo.getLatestSnapshot('t-1', 'u-1');

      expect(result).toEqual(snapshot);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.ScanIndexForward).toBe(false);
      expect(call.input.Limit).toBe(1);
    });

    it('should return null when no snapshots exist', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await repo.getLatestSnapshot('t-1', 'u-1');

      expect(result).toBeNull();
    });
  });
});
