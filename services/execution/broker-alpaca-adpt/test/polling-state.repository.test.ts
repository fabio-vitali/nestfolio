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
    withMethodLogging: jest.fn((_className: string) =>
      (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
    ),
  };
});

import { PollingStateRepository } from '../src/repositories/polling-state.repository';

const TABLE_NAME = 'test-table';
const TENANT_ID = 'tenant-1';

describe('PollingStateRepository', () => {
  let repo: PollingStateRepository;

  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
    repo = new PollingStateRepository(TABLE_NAME);
  });

  describe('getState', () => {
    it('sends GetCommand with PollingState key', async () => {
      mockSend.mockResolvedValueOnce({ Item: { pk: `PollingState#${TENANT_ID}`, openOrderCount: 3 } });

      const result = await repo.getState(TENANT_ID);

      const getCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Get');
      expect(getCalls).toHaveLength(1);
      expect(getCalls[0][0].input.Key).toEqual({
        pk: `PollingState#${TENANT_ID}`,
        sk: 'PollingState',
      });
      expect(result).not.toBeNull();
    });

    it('returns null when item not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await repo.getState(TENANT_ID);

      expect(result).toBeNull();
    });
  });

  describe('updateLastCheckedAt', () => {
    it('delegates to update with lastCheckedAt attr', async () => {
      await repo.updateLastCheckedAt(TENANT_ID, '2025-01-01T12:00:00.000Z');

      const updateCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Update');
      expect(updateCalls).toHaveLength(1);
      const input = updateCalls[0][0].input;
      expect(input.Key).toEqual({ pk: `PollingState#${TENANT_ID}`, sk: 'PollingState' });
      const values = Object.values(input.ExpressionAttributeValues as Record<string, unknown>);
      expect(values).toContain('2025-01-01T12:00:00.000Z');
    });
  });

  describe('incrementOpenOrderCount', () => {
    it('sends UpdateCommand with ADD openOrderCount :inc', async () => {
      await repo.incrementOpenOrderCount(TENANT_ID);

      const updateCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Update');
      expect(updateCalls).toHaveLength(1);
      const input = updateCalls[0][0].input;
      expect(input.Key).toEqual({ pk: `PollingState#${TENANT_ID}`, sk: 'PollingState' });
      expect(input.UpdateExpression).toContain('ADD openOrderCount :inc');
      expect(input.ExpressionAttributeValues[':inc']).toBe(1);
    });
  });

  describe('decrementOpenOrderCount', () => {
    it('sends UpdateCommand with ADD openOrderCount :dec (-1)', async () => {
      await repo.decrementOpenOrderCount(TENANT_ID);

      const updateCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Update');
      expect(updateCalls).toHaveLength(1);
      const input = updateCalls[0][0].input;
      expect(input.Key).toEqual({ pk: `PollingState#${TENANT_ID}`, sk: 'PollingState' });
      expect(input.UpdateExpression).toContain('ADD openOrderCount :dec');
      expect(input.ExpressionAttributeValues[':dec']).toBe(-1);
    });
  });
});
