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
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

import { PortfolioRepository } from '../repositories/portfolio.repository';

describe('PortfolioRepository', () => {
  let repo: PortfolioRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new PortfolioRepository('test-table');
  });

  describe('getOrCreatePortfolio', () => {
    it('should return existing portfolio when found', async () => {
      const portfolio = {
        pk: 'Portfolio#t1#p1',
        sk: 'Portfolio',
        __typename: 'Portfolio',
        tenantId: 't1',
        portfolioId: 'p1',
        totalValue: 100000,
      };
      mockSend.mockResolvedValueOnce({ Item: portfolio });

      const result = await repo.getOrCreatePortfolio('t1', 'p1');

      expect(result).toEqual(portfolio);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should create portfolio with defaults when not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined }); // get returns nothing
      mockSend.mockResolvedValueOnce({}); // put succeeds

      const result = await repo.getOrCreatePortfolio('t1', 'p1');

      expect(result).toMatchObject({
        pk: 'Portfolio#t1#p1',
        sk: 'Portfolio',
        __typename: 'Portfolio',
        tenantId: 't1',
        portfolioId: 'p1',
        totalValue: 0,
        cashBalance: 0,
        positionCount: 0,
      });
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('updatePortfolio', () => {
    it('should update portfolio fields', async () => {
      const updated = {
        pk: 'Portfolio#t1#p1',
        sk: 'Portfolio',
        totalValue: 50000,
        positionCount: 3,
      };
      mockSend.mockResolvedValueOnce({ Attributes: updated });

      const result = await repo.updatePortfolio('t1', 'p1', {
        totalValue: 50000,
        positionCount: 3,
      });

      expect(result).toEqual(updated);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('upsertPosition', () => {
    it('should create position with version 1 when no expectedVersion', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await repo.upsertPosition('t1', 'p1', 'AAPL', 100, 150, 175);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems).toHaveLength(2);
      expect(call.input.TransactItems[0].Put.Item).toMatchObject({
        pk: 'Portfolio#t1#p1',
        sk: 'Position#AAPL',
        __typename: 'Position',
        tenantId: 't1',
        instrument: 'AAPL',
        quantity: 100,
        avgCostBasis: 150,
        currentPrice: 175,
        marketValue: 17500,
        version: 1,
      });
      // No ConditionExpression when expectedVersion is undefined
      expect(call.input.TransactItems[0].Put.ConditionExpression).toBeUndefined();
      expect(call.input.TransactItems[1].Put.Item).toMatchObject({
        __typename: 'EditEvent',
        operation: 'replace',
      });
      expect(result).toMatchObject({ instrument: 'AAPL', quantity: 100, version: 1 });
    });

    it('should include conditional write when expectedVersion is provided', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await repo.upsertPosition('t1', 'p1', 'AAPL', 200, 150, 175, 3);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      const putItem = call.input.TransactItems[0].Put;
      expect(putItem.Item.version).toBe(4);
      expect(putItem.ConditionExpression).toBe('#v = :expectedVersion');
      expect(putItem.ExpressionAttributeNames).toEqual({ '#v': 'version' });
      expect(putItem.ExpressionAttributeValues).toEqual({ ':expectedVersion': 3 });
      expect(result).toMatchObject({ version: 4 });
    });
  });

  describe('getPosition', () => {
    it('should return position when found', async () => {
      const position = {
        pk: 'Portfolio#t1#p1',
        sk: 'Position#AAPL',
        instrument: 'AAPL',
        quantity: 100,
      };
      mockSend.mockResolvedValueOnce({ Item: position });

      const result = await repo.getPosition('t1', 'p1', 'AAPL');

      expect(result).toEqual(position);
    });

    it('should return null when not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await repo.getPosition('t1', 'p1', 'AAPL');

      expect(result).toBeNull();
    });
  });

  describe('getAllPositions', () => {
    it('should return all positions for a portfolio', async () => {
      const positions = [
        { instrument: 'AAPL', quantity: 100 },
        { instrument: 'MSFT', quantity: 50 },
      ];
      mockSend.mockResolvedValueOnce({ Items: positions });

      const result = await repo.getAllPositions('t1', 'p1');

      expect(result).toEqual(positions);
    });
  });

  describe('updateCashBalance', () => {
    it('should create/update cash balance record', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await repo.updateCashBalance('t1', 'p1', 'USD', 50000);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'Portfolio#t1#p1',
        sk: 'CashBalance#USD',
        __typename: 'CashBalance',
        currency: 'USD',
        amount: 50000,
      });
      expect(result).toMatchObject({ currency: 'USD', amount: 50000 });
    });
  });

  describe('getCashBalance', () => {
    it('should return cash balance when found', async () => {
      const cash = { currency: 'USD', amount: 50000 };
      mockSend.mockResolvedValueOnce({ Item: cash });

      const result = await repo.getCashBalance('t1', 'p1', 'USD');

      expect(result).toEqual(cash);
    });

    it('should return null when not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await repo.getCashBalance('t1', 'p1', 'USD');

      expect(result).toBeNull();
    });
  });

  describe('putPerformanceMetric', () => {
    it('should store performance metric', async () => {
      mockSend.mockResolvedValueOnce({});

      const metric = { returnPercent: 12.5, sharpeRatio: 1.2 };
      const result = await repo.putPerformanceMetric('t1', 'p1', 'MONTH', metric);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'Portfolio#t1#p1',
        sk: 'Performance#MONTH',
        __typename: 'PerformanceMetric',
        period: 'MONTH',
        returnPercent: 12.5,
        sharpeRatio: 1.2,
      });
      expect(result).toMatchObject({ period: 'MONTH', returnPercent: 12.5 });
    });
  });
});
