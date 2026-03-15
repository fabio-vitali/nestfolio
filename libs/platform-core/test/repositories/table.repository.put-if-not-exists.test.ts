import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository } from '../../src/repositories/table.repository';

jest.mock('../../src/logger', () => ({
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

class TestRepository extends TableRepository {
  async tryPut(item: Record<string, unknown>): Promise<boolean> {
    return this.putIfNotExists(item);
  }
}

describe('TableRepository.putIfNotExists', () => {
  let repo: TestRepository;
  let mockSend: jest.Mock;

  beforeEach(() => {
    mockSend = jest.fn();
    const mockClient = { send: mockSend } as unknown as DynamoDBClient;
    jest.spyOn(DynamoDBDocumentClient, 'from').mockReturnValue({
      send: mockSend,
    } as unknown as DynamoDBDocumentClient);
    repo = new TestRepository('test-table', mockClient);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return true when item is created (first write)', async () => {
    mockSend.mockResolvedValueOnce({});
    const item = { pk: 'Profile#t1#u1', sk: 'InvestorProfile', __typename: 'InvestorProfile' };

    const result = await repo.tryPut(item);

    expect(result).toBe(true);
    const command = mockSend.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutCommand);
    expect(command.input.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(command.input.Item).toEqual(item);
  });

  it('should return false when item already exists (ConditionalCheckFailedException)', async () => {
    const error = new Error('The conditional request failed');
    error.name = 'ConditionalCheckFailedException';
    mockSend.mockRejectedValueOnce(error);

    const result = await repo.tryPut({ pk: 'Profile#t1#u1', sk: 'InvestorProfile' });

    expect(result).toBe(false);
  });

  it('should re-throw non-conditional DynamoDB errors', async () => {
    const error = new Error('Service unavailable');
    error.name = 'InternalServerError';
    mockSend.mockRejectedValueOnce(error);

    await expect(repo.tryPut({ pk: 'x', sk: 'y' })).rejects.toThrow('Service unavailable');
  });
});
