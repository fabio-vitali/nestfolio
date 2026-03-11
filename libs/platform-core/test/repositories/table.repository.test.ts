import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository } from '../../src/repositories/table.repository';

jest.mock('../../src/logger', () => ({
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

// Concrete test implementation
class TestRepository extends TableRepository {
  async save(item: Record<string, unknown>): Promise<void> {
    return this.put(item);
  }

  async findByPk(pk: string, skPrefix?: string): Promise<Record<string, unknown>[]> {
    return this.queryByPk(pk, skPrefix);
  }
}

describe('TableRepository', () => {
  let repo: TestRepository;
  let mockSend: jest.Mock;

  beforeEach(() => {
    mockSend = jest.fn();
    const mockClient = { send: mockSend } as unknown as DynamoDBClient;
    // Patch DynamoDBDocumentClient.from to return our mock
    jest.spyOn(DynamoDBDocumentClient, 'from').mockReturnValue({
      send: mockSend,
    } as unknown as DynamoDBDocumentClient);
    repo = new TestRepository('test-table', mockClient);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('put', () => {
    it('should put an item into DynamoDB', async () => {
      mockSend.mockResolvedValue({});
      const item = { pk: 'Note#t1#n1', sk: 'Note', __typename: 'Note' };

      await repo.save(item);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(PutCommand);
      expect(command.input).toEqual({
        TableName: 'test-table',
        Item: item,
      });
    });
  });

  describe('queryByPk', () => {
    it('should query by partition key only', async () => {
      mockSend.mockResolvedValue({ Items: [{ pk: 'a', sk: 'b' }] });

      const result = await repo.findByPk('Note#t1#n1');

      expect(result).toEqual([{ pk: 'a', sk: 'b' }]);
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(QueryCommand);
      expect(command.input.KeyConditionExpression).toBe('pk = :pk');
    });

    it('should query by partition key and sort key prefix', async () => {
      mockSend.mockResolvedValue({ Items: [{ pk: 'a', sk: 'EditEvent#1' }] });

      const result = await repo.findByPk('Note#t1#n1', 'EditEvent#');

      expect(result).toHaveLength(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.input.KeyConditionExpression).toBe(
        'pk = :pk AND begins_with(sk, :sk)',
      );
    });

    it('should auto-paginate when LastEvaluatedKey is present', async () => {
      mockSend
        .mockResolvedValueOnce({
          Items: [{ pk: 'a', sk: '1' }],
          LastEvaluatedKey: { pk: 'a', sk: '1' },
        })
        .mockResolvedValueOnce({
          Items: [{ pk: 'a', sk: '2' }],
        });

      const result = await repo.findByPk('Note#t1#n1');

      expect(result).toHaveLength(2);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });
});
