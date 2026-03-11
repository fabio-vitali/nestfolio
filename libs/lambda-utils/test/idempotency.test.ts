import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { IdempotencyGuard } from '../src/idempotency';

// Mock the DynamoDB client
jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return {
    ...actual,
    DynamoDBClient: jest.fn().mockImplementation(() => ({
      send: jest.fn(),
    })),
  };
});

describe('IdempotencyGuard', () => {
  let client: jest.Mocked<DynamoDBClient>;
  let guard: IdempotencyGuard;
  const tableName = 'idempotency-table';

  beforeEach(() => {
    client = new DynamoDBClient({}) as jest.Mocked<DynamoDBClient>;
    guard = new IdempotencyGuard(client, tableName);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return true on first call (event not yet processed)', async () => {
    (client.send as jest.Mock).mockResolvedValueOnce({});

    const result = await guard.ensureOnce('MANDATE_GRANTED', 'evt-001');

    expect(result).toBe(true);
    expect(client.send).toHaveBeenCalledTimes(1);

    const command = (client.send as jest.Mock).mock.calls[0][0];
    expect(command).toBeInstanceOf(PutItemCommand);
    expect(command.input).toEqual(
      expect.objectContaining({
        TableName: tableName,
        Item: expect.objectContaining({
          pk: { S: 'Idempotency#MANDATE_GRANTED#evt-001' },
          sk: { S: 'Processed' },
        }),
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  });

  it('should return false when event was already processed (ConditionalCheckFailedException)', async () => {
    const conditionalError = new Error('The conditional request failed');
    conditionalError.name = 'ConditionalCheckFailedException';
    (client.send as jest.Mock).mockRejectedValueOnce(conditionalError);

    const result = await guard.ensureOnce('MANDATE_GRANTED', 'evt-001');

    expect(result).toBe(false);
  });

  it('should re-throw non-conditional DynamoDB errors', async () => {
    const serviceError = new Error('Service unavailable');
    serviceError.name = 'ValidationException';
    (client.send as jest.Mock).mockRejectedValueOnce(serviceError);

    await expect(
      guard.ensureOnce('MANDATE_GRANTED', 'evt-001'),
    ).rejects.toThrow('Service unavailable');
  });

  it('should include a TTL in the DynamoDB item', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    (client.send as jest.Mock).mockResolvedValueOnce({});

    await guard.ensureOnce('ORDER_SUBMITTED', 'evt-002');

    const command = (client.send as jest.Mock).mock.calls[0][0];
    const ttlValue = Number(command.input.Item.ttl.N);

    // TTL should be approximately 24 hours from now (within 5 seconds tolerance)
    expect(ttlValue).toBeGreaterThanOrEqual(nowSeconds + 86400 - 5);
    expect(ttlValue).toBeLessThanOrEqual(nowSeconds + 86400 + 5);
  });

  it('should use custom TTL when provided', async () => {
    const customTtl = 3600; // 1 hour
    const customGuard = new IdempotencyGuard(client, tableName, customTtl);
    const nowSeconds = Math.floor(Date.now() / 1000);
    (client.send as jest.Mock).mockResolvedValueOnce({});

    await customGuard.ensureOnce('ORDER_SUBMITTED', 'evt-custom');

    const command = (client.send as jest.Mock).mock.calls[0][0];
    const ttlValue = Number(command.input.Item.ttl.N);

    expect(ttlValue).toBeGreaterThanOrEqual(nowSeconds + customTtl - 5);
    expect(ttlValue).toBeLessThanOrEqual(nowSeconds + customTtl + 5);
  });

  it('should include a processedAt ISO timestamp', async () => {
    (client.send as jest.Mock).mockResolvedValueOnce({});

    await guard.ensureOnce('GOAL_UPDATED', 'evt-003');

    const command = (client.send as jest.Mock).mock.calls[0][0];
    const processedAt = command.input.Item.processedAt.S;

    // Verify it's a valid ISO date string
    expect(new Date(processedAt).toISOString()).toBe(processedAt);
  });

  it('should retry transient errors (ThrottlingException) and succeed', async () => {
    const throttleError = new Error('Rate exceeded');
    throttleError.name = 'ThrottlingException';

    (client.send as jest.Mock)
      .mockRejectedValueOnce(throttleError) // 1st attempt fails
      .mockResolvedValueOnce({});            // 2nd attempt succeeds

    const result = await guard.ensureOnce('ORDER_SUBMITTED', 'evt-004');
    expect(result).toBe(true);
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it('should throw after retries exhausted for transient errors', async () => {
    const internalError = new Error('Internal server error');
    internalError.name = 'InternalServerError';

    (client.send as jest.Mock)
      .mockRejectedValueOnce(internalError) // 1st attempt
      .mockRejectedValueOnce(internalError) // 2nd attempt (retry 1)
      .mockRejectedValueOnce(internalError); // 3rd attempt (retry 2)

    await expect(
      guard.ensureOnce('ORDER_SUBMITTED', 'evt-005'),
    ).rejects.toThrow('Internal server error');

    // 1 original + 2 retries = 3 calls
    expect(client.send).toHaveBeenCalledTimes(3);
  });
});
