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
    UpdateCommand: jest.fn().mockImplementation((input) => ({ _type: 'Update', input })),
  };
});

jest.mock('@nestfolio/event-processor', () => {
  const ddb = jest.requireMock('@aws-sdk/lib-dynamodb') as { UpdateCommand: jest.Mock };
  return {
    ...jest.requireActual('@nestfolio/event-processor'),
    TableRepository: class {
      protected readonly docClient: { send: jest.Mock };
      protected readonly tableName: string;
      constructor(tableName: string) {
        this.tableName = tableName;
        this.docClient = { send: mockSend };
      }
      protected async update(pk: string, sk: string, attrs: Record<string, unknown>) {
        const entries = Object.entries(attrs);
        const names: Record<string, string> = {};
        const values: Record<string, unknown> = {};
        const sets: string[] = [];
        entries.forEach(([k, v], i) => {
          names[`#a${i}`] = k;
          values[`:v${i}`] = v;
          sets.push(`#a${i} = :v${i}`);
        });
        await this.docClient.send(new ddb.UpdateCommand({
          TableName: this.tableName, Key: { pk, sk },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ExpressionAttributeNames: names, ExpressionAttributeValues: values,
        }));
      }
    },
    requireEnv: (name: string) => process.env[name] ?? name,
    withMethodLogging: jest.fn((_cn: string) => (_mn: string, fn: (...a: unknown[]) => unknown) => fn),
    getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  };
});

const mockGetOrder = jest.fn();
const mockCancelOrder = jest.fn();

jest.mock('../src/clients/alpaca.client', () => ({
  AlpacaClient: jest.fn().mockImplementation(() => ({
    getOrder: mockGetOrder,
    cancelOrder: mockCancelOrder,
  })),
}));

process.env.TABLE_NAME = 'test-table';

import { handler } from '../src/handlers/order-poll-handler';

describe('order-poll-handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  describe('action: poll', () => {
    it('returns FILLED status when Alpaca order is filled', async () => {
      mockGetOrder.mockResolvedValueOnce({
        status: 200,
        data: { id: 'alpaca-1', status: 'filled', filled_qty: '10', filled_avg_price: '150.25' },
      });

      const result = await handler({
        action: 'poll',
        tenantId: 'tenant-1',
        nestfolioOrderId: 'nf-1',
        alpacaOrderId: 'alpaca-1',
        backoffSeconds: 10,
      });

      expect(result).toEqual({
        status: 'FILLED',
        tenantId: 'tenant-1',
        nestfolioOrderId: 'nf-1',
        alpacaOrderId: 'alpaca-1',
        filledQuantity: 10,
        averageFillPrice: 150.25,
        backoffSeconds: 10,
      });
    });

    it('returns PARTIALLY_FILLED status', async () => {
      mockGetOrder.mockResolvedValueOnce({
        status: 200,
        data: { id: 'alpaca-1', status: 'partially_filled', filled_qty: '5', filled_avg_price: '150.00' },
      });

      const result = await handler({
        action: 'poll',
        tenantId: 'tenant-1',
        nestfolioOrderId: 'nf-1',
        alpacaOrderId: 'alpaca-1',
        backoffSeconds: 10,
      });

      expect(result.status).toBe('PARTIALLY_FILLED');
      expect(result.filledQuantity).toBe(5);
    });

    it('returns OPEN status when order is still pending', async () => {
      mockGetOrder.mockResolvedValueOnce({
        status: 200,
        data: { id: 'alpaca-1', status: 'new', filled_qty: '0', filled_avg_price: '0' },
      });

      const result = await handler({
        action: 'poll',
        tenantId: 'tenant-1',
        nestfolioOrderId: 'nf-1',
        alpacaOrderId: 'alpaca-1',
        backoffSeconds: 10,
      });

      expect(result.status).toBe('OPEN');
    });

    it('returns REJECTED when Alpaca returns 404', async () => {
      mockGetOrder.mockResolvedValueOnce({ status: 404, data: {} });

      const result = await handler({
        action: 'poll',
        tenantId: 'tenant-1',
        nestfolioOrderId: 'nf-1',
        alpacaOrderId: 'alpaca-1',
        backoffSeconds: 10,
      });

      expect(result.status).toBe('REJECTED');
    });

    it('throws on 429 or 5xx to trigger SF retry', async () => {
      mockGetOrder.mockResolvedValueOnce({ status: 429, data: {} });

      await expect(handler({
        action: 'poll',
        tenantId: 'tenant-1',
        nestfolioOrderId: 'nf-1',
        alpacaOrderId: 'alpaca-1',
        backoffSeconds: 10,
      })).rejects.toThrow('Alpaca API error: 429');
    });
  });

  describe('action: write', () => {
    it('updates order status in DynamoDB', async () => {
      await handler({
        action: 'write',
        tenantId: 'tenant-1',
        nestfolioOrderId: 'nf-1',
        alpacaOrderId: 'alpaca-1',
        status: 'FILLED',
        filledQuantity: 10,
        averageFillPrice: 150.25,
        backoffSeconds: 10,
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Key: { pk: 'OrderMapping#tenant-1#nf-1', sk: 'OrderMapping' },
          }),
        }),
      );
    });
  });

  describe('action: timeout', () => {
    it('cancels order at Alpaca then writes CANCELLED', async () => {
      mockCancelOrder.mockResolvedValueOnce({ status: 204, data: null });

      await handler({
        action: 'timeout',
        tenantId: 'tenant-1',
        nestfolioOrderId: 'nf-1',
        alpacaOrderId: 'alpaca-1',
        backoffSeconds: 300,
      });

      expect(mockCancelOrder).toHaveBeenCalledWith('alpaca-1');
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Key: { pk: 'OrderMapping#tenant-1#nf-1', sk: 'OrderMapping' },
          }),
        }),
      );
    });

    it('fetches actual status when cancel fails (order already filled)', async () => {
      mockCancelOrder.mockResolvedValueOnce({ status: 422, data: { message: 'already filled' } });
      mockGetOrder.mockResolvedValueOnce({
        status: 200,
        data: { id: 'alpaca-1', status: 'filled', filled_qty: '10', filled_avg_price: '150.25' },
      });

      await handler({
        action: 'timeout',
        tenantId: 'tenant-1',
        nestfolioOrderId: 'nf-1',
        alpacaOrderId: 'alpaca-1',
        backoffSeconds: 300,
      });

      expect(mockGetOrder).toHaveBeenCalledWith('alpaca-1');
      // Should write FILLED, not CANCELLED
      expect(mockSend).toHaveBeenCalled();
    });
  });
});
