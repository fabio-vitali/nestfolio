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

jest.mock('@nestfolio/event-processor', () => {
  const ddb = jest.requireMock('@aws-sdk/lib-dynamodb') as {
    PutCommand: jest.Mock; QueryCommand: jest.Mock; TransactWriteCommand: jest.Mock;
  };
  return {
  TableRepository: class {
    protected readonly docClient: { send: jest.Mock };
    protected readonly tableName: string;
    constructor(tableName: string) {
      this.tableName = tableName;
      this.docClient = { send: mockSend };
    }
    protected async put(item: Record<string, unknown>) {
      await this.docClient.send(new ddb.PutCommand({ TableName: this.tableName, Item: item }));
    }
    protected async putIfNotExists(item: Record<string, unknown>): Promise<boolean> {
      await this.docClient.send(new ddb.PutCommand({ TableName: this.tableName, Item: item, ConditionExpression: 'attribute_not_exists(pk)' }));
      return true;
    }
    protected async queryByPk(pk: string, skPrefix?: string) {
      const result = await this.docClient.send(new ddb.QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: skPrefix ? 'pk = :pk AND begins_with(sk, :sk)' : 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk, ...(skPrefix ? { ':sk': skPrefix } : {}) },
      }));
      return result.Items ?? [];
    }
    protected async transactWrite(input: unknown) {
      await this.docClient.send(new ddb.TransactWriteCommand(input));
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

  withMethodLogging: jest.fn().mockImplementation(() =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
  guardedWrite: jest.fn().mockResolvedValue(true),

  };
});
import { DashboardRepository } from '../../../src/repositories/dashboard.repository';
import type { RequestContext } from '@nestfolio/event-processor';

const TEST_CTX: RequestContext = { tenantId: 'tenant-1', userId: 'user-1', region: 'us-east-1' };

describe('DashboardRepository', () => {
  let repository: DashboardRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new DashboardRepository('test-table');
  });

  describe('upsertPortfolioSummary', () => {
    it('should update portfolio summary with provided fields', async () => {
      mockSend.mockResolvedValueOnce({});

      await repository.upsertPortfolioSummary('tenant-1', {
        totalValueCents: 12500000,
        positionCount: 5,
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.Key).toEqual({ pk: 'T#tenant-1', sk: 'PortfolioSummary' });
      expect(cmd.input.ExpressionAttributeValues[':totalValueCents']).toBe(12500000);
      expect(cmd.input.ExpressionAttributeValues[':positionCount']).toBe(5);
    });
  });

  describe('atomicIncrementTotalValue', () => {
    it('should use if_not_exists(totalValueCents, :zero) + :delta expression', async () => {
      mockSend.mockResolvedValueOnce({});

      await repository.atomicIncrementTotalValue('tenant-1', 500000);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.Key).toEqual({ pk: 'T#tenant-1', sk: 'PortfolioSummary' });
      expect(cmd.input.UpdateExpression).toContain('totalValueCents = if_not_exists(totalValueCents, :zero) + :delta');
      expect(cmd.input.ExpressionAttributeValues[':zero']).toBe(0);
      expect(cmd.input.ExpressionAttributeValues[':delta']).toBe(500000);
    });

    it('should support negative deltas for decrements', async () => {
      mockSend.mockResolvedValueOnce({});

      await repository.atomicIncrementTotalValue('tenant-1', -250000);

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.ExpressionAttributeValues[':delta']).toBe(-250000);
    });

    it('should include extra updates when provided', async () => {
      mockSend.mockResolvedValueOnce({});

      await repository.atomicIncrementTotalValue('tenant-1', 100000, { positionCount: 5 });

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.UpdateExpression).toContain('positionCount = :positionCount');
      expect(cmd.input.ExpressionAttributeValues[':positionCount']).toBe(5);
    });
  });

  describe('upsertPositionSnapshot', () => {
    it('should put a position snapshot item', async () => {
      mockSend.mockResolvedValueOnce({});

      await repository.upsertPositionSnapshot({
        symbol: 'AAPL',
        quantity: 50,
        avgCostBasisCents: 15000,
        currentPriceCents: 17500,
        marketValueCents: 875000,
        weightPercent: 35.5,
        unrealizedPnlCents: 125000,
      }, TEST_CTX);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.Item.pk).toBe('T#tenant-1');
      expect(cmd.input.Item.sk).toBe('PositionSnapshot#AAPL');
      expect(cmd.input.Item.__typename).toBe('PositionSnapshot');
      expect(cmd.input.Item.symbol).toBe('AAPL');
      expect(cmd.input.Item.quantity).toBe(50);
    });
  });

  describe('getPositionSnapshots', () => {
    it('should query positions by pk prefix', async () => {
      const positions = [
        { symbol: 'AAPL', quantity: 50 },
        { symbol: 'MSFT', quantity: 30 },
      ];
      mockSend.mockResolvedValueOnce({ Items: positions });

      const result = await repository.getPositionSnapshots('tenant-1');
      expect(result).toEqual(positions);
    });
  });

  describe('addActivity', () => {
    it('should put an activity item with TTL', async () => {
      mockSend.mockResolvedValueOnce({});

      await repository.addActivity('evt-123', {
        activityType: 'ORDER_FILLED',
        description: 'Order filled: AAPL',
        metadata: { orderId: 'o1' },
      }, TEST_CTX);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.Item.pk).toBe('T#tenant-1');
      expect(cmd.input.Item.sk).toMatch(/^Activity#/);
      expect(cmd.input.Item.__typename).toBe('RecentActivity');
      expect(cmd.input.Item.activityType).toBe('ORDER_FILLED');
      expect(cmd.input.Item.ttl).toBeGreaterThan(0);
    });
  });

  describe('getRecentActivity', () => {
    it('should query activities with limit and reverse order', async () => {
      const activities = [{ activityType: 'ORDER_FILLED', description: 'Order filled' }];
      mockSend.mockResolvedValueOnce({ Items: activities });

      const result = await repository.getRecentActivity('tenant-1', 10);
      expect(result).toEqual(activities);

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.ScanIndexForward).toBe(false);
      expect(cmd.input.Limit).toBe(10);
    });
  });

  describe('upsertAdvisoryStatus', () => {
    it('should increment pending decisions count with delta', async () => {
      mockSend.mockResolvedValueOnce({});

      await repository.upsertAdvisoryStatus('tenant-1', {
        pendingDecisionsDelta: 1,
        lastRecommendationAt: '2025-01-01T00:00:00.000Z',
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.Key).toEqual({ pk: 'T#tenant-1', sk: 'AdvisoryStatus' });
      expect(cmd.input.UpdateExpression).toContain('if_not_exists(pendingDecisionsCount, :zero) + :delta');
      expect(cmd.input.ExpressionAttributeValues[':delta']).toBe(1);
    });

    it('should set absolute pending count when provided', async () => {
      mockSend.mockResolvedValueOnce({});

      await repository.upsertAdvisoryStatus('tenant-1', {
        pendingDecisionsCount: 3,
        lastDecisionStatus: 'APPROVED',
      });

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.ExpressionAttributeValues[':pendingDecisionsCount']).toBe(3);
      expect(cmd.input.ExpressionAttributeValues[':lastDecisionStatus']).toBe('APPROVED');
    });
  });

  describe('upsertInvestorSnapshot', () => {
    it('should update investor snapshot with provided fields', async () => {
      mockSend.mockResolvedValueOnce({});

      await repository.upsertInvestorSnapshot('tenant-1', {
        goalType: 'Retirement',
        riskLevel: '7',
        operatingMode: 'BALANCED',
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.Key).toEqual({ pk: 'T#tenant-1', sk: 'InvestorSnapshot' });
      expect(cmd.input.ExpressionAttributeValues[':goalType']).toBe('Retirement');
      expect(cmd.input.ExpressionAttributeValues[':riskLevel']).toBe('7');
    });
  });

  describe('getDashboard', () => {
    it('should return aggregated dashboard from 3 GetCommands', async () => {
      const portfolioSummary = { totalValueCents: 12500000 };
      const advisoryStatus = { pendingDecisionsCount: 2 };
      const investorSnapshot = { goalType: 'Retirement' };

      mockSend
        .mockResolvedValueOnce({ Item: portfolioSummary })
        .mockResolvedValueOnce({ Item: advisoryStatus })
        .mockResolvedValueOnce({ Item: investorSnapshot });

      const result = await repository.getDashboard('tenant-1');

      expect(result.portfolioSummary).toEqual(portfolioSummary);
      expect(result.advisoryStatus).toEqual(advisoryStatus);
      expect(result.investorSnapshot).toEqual(investorSnapshot);
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('should return null for missing projections', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: undefined })
        .mockResolvedValueOnce({ Item: undefined })
        .mockResolvedValueOnce({ Item: undefined });

      const result = await repository.getDashboard('tenant-1');

      expect(result.portfolioSummary).toBeNull();
      expect(result.advisoryStatus).toBeNull();
      expect(result.investorSnapshot).toBeNull();
    });
  });
});
