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
    UpdateCommand: jest.fn().mockImplementation((input) => ({ _type: 'Update', input })),
  };
});

jest.mock('@nestfolio/event-processor', () => {
  return {
    TableRepository: class {
      protected readonly docClient: { send: jest.Mock };
      protected readonly tableName: string;
      constructor(tableName: string) {
        this.tableName = tableName;
        this.docClient = { send: mockSend };
      }
      protected async update(pk: string, sk: string, attrs: Record<string, unknown>) {
        const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
        const entries = Object.entries(attrs);
        const names: Record<string, string> = {};
        const values: Record<string, unknown> = {};
        const sets: string[] = [];
        entries.forEach(([k, v], i) => {
          names[`#a${i}`] = k;
          values[`:v${i}`] = v;
          sets.push(`#a${i} = :v${i}`);
        });
        await this.docClient.send(new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }));
      }
    },
    getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
    withMethodLogging: jest.fn((_className: string) =>
      (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
    ),
  };
});

import { CircuitBreakerRepository } from '../../src/repositories/circuit-breaker.repository';

const TABLE_NAME = 'test-table';
const ADAPTER_ID = 'alpaca';
const FIXED_TIME = '2025-01-01T00:00:00.000Z';

describe('CircuitBreakerRepository', () => {
  let repo: CircuitBreakerRepository;

  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
    repo = new CircuitBreakerRepository(TABLE_NAME);
  });

  describe('isOpen', () => {
    it('returns false when no breaker record exists', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await repo.isOpen(ADAPTER_ID);

      expect(result).toBe(false);
      const getCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Get');
      expect(getCalls).toHaveLength(1);
      expect(getCalls[0][0].input.Key).toEqual({
        pk: `CircuitBreaker#${ADAPTER_ID}`,
        sk: 'CircuitBreaker',
      });
    });

    it('returns true when breaker record has state OPEN', async () => {
      mockSend.mockResolvedValueOnce({ Item: { pk: `CircuitBreaker#${ADAPTER_ID}`, sk: 'CircuitBreaker', state: 'OPEN' } });

      const result = await repo.isOpen(ADAPTER_ID);

      expect(result).toBe(true);
    });

    it('returns false when breaker record has state CLOSED', async () => {
      mockSend.mockResolvedValueOnce({ Item: { pk: `CircuitBreaker#${ADAPTER_ID}`, sk: 'CircuitBreaker', state: 'CLOSED' } });

      const result = await repo.isOpen(ADAPTER_ID);

      expect(result).toBe(false);
    });
  });

  describe('open', () => {
    it('calls put with correct DDB item shape and condition expression', async () => {
      const result = await repo.open(ADAPTER_ID, 'Alpaca API error rate too high');

      expect(result).toBe(true);
      const putCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Put');
      expect(putCalls).toHaveLength(1);
      const input = putCalls[0][0].input;
      expect(input.Item).toEqual({
        pk: `CircuitBreaker#${ADAPTER_ID}`,
        sk: 'CircuitBreaker',
        __typename: 'CircuitBreaker',
        state: 'OPEN',
        adapter: ADAPTER_ID,
        openedAt: FIXED_TIME,
        reason: 'Alpaca API error rate too high',
      });
      expect(input.ConditionExpression).toBe('attribute_not_exists(pk) OR #st <> :open');
      expect(input.ExpressionAttributeNames).toEqual({ '#st': 'state' });
      expect(input.ExpressionAttributeValues).toEqual({ ':open': 'OPEN' });
    });

    it('returns false on ConditionalCheckFailedException (already open)', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(error);

      const result = await repo.open(ADAPTER_ID, 'duplicate open');

      expect(result).toBe(false);
    });

    it('rethrows unexpected errors', async () => {
      const error = new Error('InternalServerError');
      error.name = 'InternalServerError';
      mockSend.mockRejectedValueOnce(error);

      await expect(repo.open(ADAPTER_ID, 'test')).rejects.toThrow('InternalServerError');
    });
  });

  describe('close', () => {
    it('calls update with state CLOSED and closedAt timestamp', async () => {
      await repo.close(ADAPTER_ID);

      const updateCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Update');
      expect(updateCalls).toHaveLength(1);
      const input = updateCalls[0][0].input;
      expect(input.Key).toEqual({
        pk: `CircuitBreaker#${ADAPTER_ID}`,
        sk: 'CircuitBreaker',
      });
      const values = Object.values(input.ExpressionAttributeValues as Record<string, unknown>);
      expect(values).toContain('CLOSED');
      expect(values).toContain(FIXED_TIME);
    });
  });
});
