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
      protected async put(item: Record<string, unknown>) {
        const { PutCommand } = require('@aws-sdk/lib-dynamodb');
        await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item }));
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

import { OrderMappingRepository } from '../src/repositories/order-mapping.repository';

const TABLE_NAME = 'test-table';
const TENANT_ID = 'tenant-1';
const NESTFOLIO_ORDER_ID = 'nf-order-123';
const ALPACA_ORDER_ID = 'alpaca-456';
const FIXED_TIME = '2025-01-01T00:00:00.000Z';

describe('OrderMappingRepository', () => {
  let repo: OrderMappingRepository;

  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
    repo = new OrderMappingRepository(TABLE_NAME);
  });

  describe('createMapping', () => {
    it('writes forward and reverse lookup records', async () => {
      await repo.createMapping(TENANT_ID, NESTFOLIO_ORDER_ID, ALPACA_ORDER_ID, 'AAPL', 'BUY', 10);

      const putCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Put');
      expect(putCalls).toHaveLength(2);

      // Forward lookup
      const forwardItem = putCalls[0][0].input.Item;
      expect(forwardItem.pk).toBe(`OrderMapping#${TENANT_ID}#${NESTFOLIO_ORDER_ID}`);
      expect(forwardItem.sk).toBe('OrderMapping');
      expect(forwardItem.__typename).toBe('AlpacaOrderResult');
      expect(forwardItem.tenantId).toBe(TENANT_ID);
      expect(forwardItem.nestfolioOrderId).toBe(NESTFOLIO_ORDER_ID);
      expect(forwardItem.alpacaOrderId).toBe(ALPACA_ORDER_ID);
      expect(forwardItem.symbol).toBe('AAPL');
      expect(forwardItem.side).toBe('BUY');
      expect(forwardItem.requestedQty).toBe(10);
      expect(forwardItem.status).toBe('PLACED');
      expect(forwardItem.timestamp).toBe(FIXED_TIME);

      // Reverse lookup
      const reverseItem = putCalls[1][0].input.Item;
      expect(reverseItem.pk).toBe(`AlpacaOrder#${TENANT_ID}#${ALPACA_ORDER_ID}`);
      expect(reverseItem.sk).toBe('OrderMapping');
      expect(reverseItem.nestfolioOrderId).toBe(NESTFOLIO_ORDER_ID);
      expect(reverseItem.alpacaOrderId).toBe(ALPACA_ORDER_ID);
    });
  });

  describe('getByNestfolioOrderId', () => {
    it('sends GetCommand with correct key', async () => {
      mockSend.mockResolvedValueOnce({ Item: { pk: 'OrderMapping#tenant-1#nf-order-123', sk: 'OrderMapping' } });

      const result = await repo.getByNestfolioOrderId(TENANT_ID, NESTFOLIO_ORDER_ID);

      const getCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Get');
      expect(getCalls).toHaveLength(1);
      expect(getCalls[0][0].input.Key).toEqual({
        pk: `OrderMapping#${TENANT_ID}#${NESTFOLIO_ORDER_ID}`,
        sk: 'OrderMapping',
      });
      expect(result).not.toBeNull();
    });

    it('returns null when item not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await repo.getByNestfolioOrderId(TENANT_ID, NESTFOLIO_ORDER_ID);

      expect(result).toBeNull();
    });
  });

  describe('getByAlpacaOrderId', () => {
    it('sends GetCommand with reverse lookup key', async () => {
      mockSend.mockResolvedValueOnce({ Item: { pk: 'AlpacaOrder#tenant-1#alpaca-456', sk: 'OrderMapping' } });

      const result = await repo.getByAlpacaOrderId(TENANT_ID, ALPACA_ORDER_ID);

      const getCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Get');
      expect(getCalls).toHaveLength(1);
      expect(getCalls[0][0].input.Key).toEqual({
        pk: `AlpacaOrder#${TENANT_ID}#${ALPACA_ORDER_ID}`,
        sk: 'OrderMapping',
      });
      expect(result).not.toBeNull();
    });

    it('returns null when item not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await repo.getByAlpacaOrderId(TENANT_ID, ALPACA_ORDER_ID);

      expect(result).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('sends UpdateCommand with status and updatedAt', async () => {
      await repo.updateStatus(TENANT_ID, NESTFOLIO_ORDER_ID, 'FILLED');

      const updateCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Update');
      expect(updateCalls).toHaveLength(1);
      const updateInput = updateCalls[0][0].input;
      expect(updateInput.Key).toEqual({
        pk: `OrderMapping#${TENANT_ID}#${NESTFOLIO_ORDER_ID}`,
        sk: 'OrderMapping',
      });
      const values = Object.values(updateInput.ExpressionAttributeValues as Record<string, unknown>);
      expect(values).toContain('FILLED');
      expect(values).toContain(FIXED_TIME);
    });

    it('merges additional updates', async () => {
      await repo.updateStatus(TENANT_ID, NESTFOLIO_ORDER_ID, 'FILLED', { filledQty: 5 });

      const updateCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Update');
      expect(updateCalls).toHaveLength(1);
      const values = Object.values(updateCalls[0][0].input.ExpressionAttributeValues as Record<string, unknown>);
      expect(values).toContain(5);
    });

    it('includes ConditionExpression to prevent duplicate status writes', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateStatus('tenant-1', 'nf-order-1', 'FILLED', { filledQuantity: 10 });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            ConditionExpression: expect.stringContaining('#status'),
          }),
        }),
      );
    });

    it('does not throw on ConditionalCheckFailedException (treats as no-op)', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(error);

      await expect(repo.updateStatus('tenant-1', 'nf-order-1', 'FILLED')).resolves.not.toThrow();
    });
  });
});
