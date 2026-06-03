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
import { PortfolioRepository } from '../../../src/repositories/portfolio.repository';

describe('PortfolioRepository', () => {
  let repo: PortfolioRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ Items: [] });
    repo = new PortfolioRepository('test-table');
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

  describe('getSimulationLatest', () => {
    it('should return simulation latest when found', async () => {
      const item = { pk: 'Simulation#t1', sk: 'Latest', cashBalanceCents: 100_000 };
      mockSend.mockResolvedValue({ Item: item });

      const result = await repo.getSimulationLatest('t1');
      expect(result).toEqual(item);
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
