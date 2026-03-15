import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { guardedWrite } from '../src/guarded-write';

describe('guardedWrite', () => {
  let mockDocClient: { send: jest.Mock };

  beforeEach(() => {
    mockDocClient = { send: jest.fn() };
  });

  it('should return true on first call (guard marker created)', async () => {
    mockDocClient.send.mockResolvedValueOnce({});

    const result = await guardedWrite(
      mockDocClient as unknown as DynamoDBDocumentClient,
      'test-table',
      { pk: 'Dashboard#t1', sk: 'ProcessedEvent#evt-1#portfolioSummary' },
      [
        {
          Update: {
            TableName: 'test-table',
            Key: { pk: 'Dashboard#t1', sk: 'PortfolioSummary' },
            UpdateExpression: 'SET totalValueCents = if_not_exists(totalValueCents, :zero) + :delta',
            ExpressionAttributeValues: { ':zero': 0, ':delta': 5000 },
          },
        },
      ],
    );

    expect(result).toBe(true);
    expect(mockDocClient.send).toHaveBeenCalledTimes(1);
    const command = mockDocClient.send.mock.calls[0][0];
    expect(command).toBeInstanceOf(TransactWriteCommand);

    // First TransactItem should be the guard marker with condition
    const items = command.input.TransactItems;
    expect(items[0].Put.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(items[0].Put.Item.pk).toBe('Dashboard#t1');
    expect(items[0].Put.Item.sk).toBe('ProcessedEvent#evt-1#portfolioSummary');
    expect(items[0].Put.Item.__typename).toBe('ProcessedEvent');
    expect(items[0].Put.Item.ttl).toBeGreaterThan(0);

    // Second item should be the business operation
    expect(items[1].Update).toBeDefined();
  });

  it('should return false when guard marker already exists (duplicate)', async () => {
    const cancelledError = new Error('Transaction cancelled');
    cancelledError.name = 'TransactionCanceledException';
    (cancelledError as any).CancellationReasons = [
      { Code: 'ConditionalCheckFailed' },
      { Code: 'None' },
    ];
    mockDocClient.send.mockRejectedValueOnce(cancelledError);

    const result = await guardedWrite(
      mockDocClient as unknown as DynamoDBDocumentClient,
      'test-table',
      { pk: 'Dashboard#t1', sk: 'ProcessedEvent#evt-1#portfolioSummary' },
      [{ Update: { TableName: 'test-table', Key: { pk: 'x', sk: 'y' }, UpdateExpression: 'SET a = :a', ExpressionAttributeValues: { ':a': 1 } } }],
    );

    expect(result).toBe(false);
  });

  it('should re-throw when TransactionCanceledException is NOT caused by guard marker', async () => {
    const cancelledError = new Error('Transaction cancelled');
    cancelledError.name = 'TransactionCanceledException';
    (cancelledError as any).CancellationReasons = [
      { Code: 'None' },
      { Code: 'ConditionalCheckFailed' },
    ];
    mockDocClient.send.mockRejectedValueOnce(cancelledError);

    await expect(
      guardedWrite(
        mockDocClient as unknown as DynamoDBDocumentClient,
        'test-table',
        { pk: 'x', sk: 'y' },
        [{ Update: { TableName: 'test-table', Key: { pk: 'a', sk: 'b' }, UpdateExpression: 'SET a = :a', ExpressionAttributeValues: { ':a': 1 } } }],
      ),
    ).rejects.toThrow('Transaction cancelled');
  });

  it('should re-throw non-TransactionCanceledException errors', async () => {
    const error = new Error('DynamoDB unavailable');
    error.name = 'InternalServerError';
    mockDocClient.send.mockRejectedValueOnce(error);

    await expect(
      guardedWrite(
        mockDocClient as unknown as DynamoDBDocumentClient,
        'test-table',
        { pk: 'x', sk: 'y' },
        [],
      ),
    ).rejects.toThrow('DynamoDB unavailable');
  });

  it('should accept custom TTL (default is 86400)', async () => {
    mockDocClient.send.mockResolvedValueOnce({});
    const nowSeconds = Math.floor(Date.now() / 1000);

    await guardedWrite(
      mockDocClient as unknown as DynamoDBDocumentClient,
      'test-table',
      { pk: 'x', sk: 'y' },
      [],
      604800, // 7 days for financial operations
    );

    const command = mockDocClient.send.mock.calls[0][0];
    const ttl = command.input.TransactItems[0].Put.Item.ttl;
    expect(ttl).toBeGreaterThanOrEqual(nowSeconds + 604800 - 5);
    expect(ttl).toBeLessThanOrEqual(nowSeconds + 604800 + 5);
  });
});
