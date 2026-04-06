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
  };
});

jest.mock('@nestfolio/event-processor', () => {
  const ddb = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock; QueryCommand: jest.Mock };
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
    protected async queryByPk(pk: string, skPrefix?: string) {
      const result = await this.docClient.send(new ddb.QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: skPrefix ? 'pk = :pk AND begins_with(sk, :sk)' : 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk, ...(skPrefix ? { ':sk': skPrefix } : {}) },
      }));
      return result.Items ?? [];
    }
    protected async queryAll(input: unknown) {
      const result = await this.docClient.send(new ddb.QueryCommand(input));
      return result.Items ?? [];
    }
  },
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },

  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),

  };
});
import { PortfolioRepository } from '../../src/repositories/portfolio.repository';

const TEST_CTX = { tenantId: 'tenant-1', userId: 'user-1', region: 'us-east-1' };

describe('PortfolioRepository', () => {
  let repo: PortfolioRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ Items: [] });
    repo = new PortfolioRepository('test-table');
  });

  describe('upsertBalance', () => {
    it('should update balance for tenant', async () => {
      mockSend.mockResolvedValue({});

      await repo.upsertBalance('tenant-1', 950_000, -50_000);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._type).toBe('Update');
      expect(cmd.input.Key).toEqual({ pk: 'Portfolio#tenant-1', sk: 'Latest' });
      expect(cmd.input.ExpressionAttributeValues[':balance']).toBe(950_000);
      expect(cmd.input.ExpressionAttributeValues[':delta']).toBe(-50_000);
    });
  });

  describe('getLatest', () => {
    it('should return item when found', async () => {
      const item = { pk: 'Portfolio#t1', sk: 'Latest', cashBalanceCents: 100_000 };
      mockSend.mockResolvedValue({ Item: item });

      const result = await repo.getLatest('t1');
      expect(result).toEqual(item);
    });

    it('should return null when not found', async () => {
      mockSend.mockResolvedValue({});

      const result = await repo.getLatest('t1');
      expect(result).toBeNull();
    });
  });

  describe('appendHistory', () => {
    it('should write history entry with zero-padded sequence', async () => {
      mockSend.mockResolvedValue({});

      await repo.appendHistory({
        eventId: 'evt-1',
        eventType: 'ORDER_FILLED',
        payload: { symbol: 'VTI', quantity: 10 },
        timestamp: '2025-01-01T00:00:00.000Z',
        sequenceNo: 42,
      }, TEST_CTX as any);

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._type).toBe('Put');
      expect(cmd.input.Item.pk).toBe('History#tenant-1');
      expect(cmd.input.Item.sk).toBe('00000042#evt-1');
      expect(cmd.input.Item.__typename).toBe('HistoryEntry');
      expect(cmd.input.Item.sequenceNo).toBe(42);
    });
  });

  describe('saveCheckpoint', () => {
    it('should write checkpoint with conditional put', async () => {
      mockSend.mockResolvedValue({});

      await repo.saveCheckpoint('2025-01-01', {
        cashBalanceCents: 950_000,
        positions: {},
      }, TEST_CTX as any);

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._type).toBe('Put');
      expect(cmd.input.Item.pk).toBe('Checkpoint#tenant-1');
      expect(cmd.input.Item.sk).toBe('2025-01-01');
      expect(cmd.input.ConditionExpression).toBe('attribute_not_exists(pk)');
    });
  });

  describe('getPositions', () => {
    it('should query positions for tenant', async () => {
      const positions = [
        { symbol: 'VTI', quantity: 10 },
        { symbol: 'SPY', quantity: 5 },
      ];
      mockSend.mockResolvedValue({ Items: positions });

      const result = await repo.getPositions('tenant-1');
      expect(result).toHaveLength(2);
    });
  });

  describe('getCheckpointBefore', () => {
    it('should return closest checkpoint before date', async () => {
      const checkpoint = { pk: 'Checkpoint#t1', sk: '2025-01-01', cashBalanceCents: 100_000 };
      mockSend.mockResolvedValue({ Items: [checkpoint] });

      const result = await repo.getCheckpointBefore('t1', '2025-01-15');
      expect(result).toEqual(checkpoint);
    });

    it('should return null when no checkpoints exist', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      const result = await repo.getCheckpointBefore('t1', '2025-01-15');
      expect(result).toBeNull();
    });
  });

  describe('getSimulationLatest', () => {
    it('should return simulation latest when found', async () => {
      const item = { pk: 'Simulation#t1', sk: 'Latest', cashBalanceCents: 100_000 };
      mockSend.mockResolvedValue({ Item: item });

      const result = await repo.getSimulationLatest('t1');
      expect(result).toEqual(item);
    });
  });

  describe('upsertSimulation', () => {
    it('should write simulation latest state', async () => {
      mockSend.mockResolvedValue({});

      await repo.upsertSimulation({
        cashBalanceCents: 900_000,
        positions: {},
      }, TEST_CTX as any);

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd._type).toBe('Put');
      expect(cmd.input.Item.pk).toBe('Simulation#tenant-1');
      expect(cmd.input.Item.sk).toBe('Latest');
    });
  });

  describe('saveSnapshotAt', () => {
    it('should write a SnapshotAt item with TTL', async () => {
      mockSend.mockResolvedValueOnce({}); // put

      const snapshotCtx = { tenantId: 't1', userId: 'u1', region: 'us-east-1' };
      await repo.saveSnapshotAt('actual', '2025-06-15T12:00:00.000Z', {
        cashBalanceCents: 7_500_000,
        positions: { VTI: { symbol: 'VTI', quantity: 10, averageCostBasis: 250, totalCostBasis: 2500, lastFillPrice: 250 } },
      }, 365, snapshotCtx as any);

      const { PutCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { PutCommand: jest.Mock };
      const putCall = PutCommand.mock.calls[0][0];
      expect(putCall.Item.pk).toBe('SnapshotAt#t1#actual');
      expect(putCall.Item.sk).toBe('2025-06-15T12:00:00.000Z');
      expect(putCall.Item.__typename).toBe('SnapshotAt');
      expect(putCall.Item.cashBalanceCents).toBe(7_500_000);
      expect(putCall.Item.ttl).toBeGreaterThan(0);
    });
  });

  describe('getSnapshotAt', () => {
    it('should return the most recent snapshot at or before timestamp', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [{
          pk: 'SnapshotAt#t1#actual',
          sk: '2025-06-14T23:59:00.000Z',
          cashBalanceCents: 7_500_000,
          positions: {},
        }],
      });

      const result = await repo.getSnapshotAt('t1', '2025-06-15T12:00:00.000Z');
      expect(result).toBeDefined();
      expect(result!['cashBalanceCents']).toBe(7_500_000);

      const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb') as { QueryCommand: jest.Mock };
      const queryInput = QueryCommand.mock.calls[0][0];
      expect(queryInput.ExpressionAttributeValues[':pk']).toBe('SnapshotAt#t1#actual');
      expect(queryInput.ScanIndexForward).toBe(false);
      expect(queryInput.Limit).toBe(1);
    });

    it('should return null when no snapshot exists', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await repo.getSnapshotAt('t1', '2025-01-01T00:00:00.000Z');
      expect(result).toBeNull();
    });
  });
});
