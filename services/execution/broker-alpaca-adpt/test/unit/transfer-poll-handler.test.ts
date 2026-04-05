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

const mockGetTransfer = jest.fn();

jest.mock('../../src/clients/alpaca.client', () => ({
  AlpacaClient: jest.fn().mockImplementation(() => ({
    getTransfer: mockGetTransfer,
  })),
}));

process.env.TABLE_NAME = 'test-table';

import { handler } from '../../src/handlers/transfer-poll-handler';

describe('transfer-poll-handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  describe('action: poll', () => {
    it('returns COMPLETED when Alpaca transfer is COMPLETE', async () => {
      mockGetTransfer.mockResolvedValueOnce({
        status: 200,
        data: { id: 'alpaca-t-1', status: 'COMPLETE', amount: '10000', direction: 'INCOMING' },
      });

      const result = await handler({
        action: 'poll',
        tenantId: 'tenant-1',
        nestfolioTransferId: 'nf-t-1',
        alpacaTransferId: 'alpaca-t-1',
        backoffSeconds: 60,
      });

      expect(result.status).toBe('COMPLETED');
    });

    it('returns FAILED when Alpaca transfer is REJECTED', async () => {
      mockGetTransfer.mockResolvedValueOnce({
        status: 200,
        data: { id: 'alpaca-t-1', status: 'REJECTED', amount: '10000', direction: 'INCOMING' },
      });

      const result = await handler({
        action: 'poll',
        tenantId: 'tenant-1',
        nestfolioTransferId: 'nf-t-1',
        alpacaTransferId: 'alpaca-t-1',
        backoffSeconds: 60,
      });

      expect(result.status).toBe('FAILED');
    });

    it('returns FAILED when Alpaca transfer is RETURNED', async () => {
      mockGetTransfer.mockResolvedValueOnce({
        status: 200,
        data: { id: 'alpaca-t-1', status: 'RETURNED', amount: '10000', direction: 'OUTGOING' },
      });

      const result = await handler({
        action: 'poll',
        tenantId: 'tenant-1',
        nestfolioTransferId: 'nf-t-1',
        alpacaTransferId: 'alpaca-t-1',
        backoffSeconds: 60,
      });

      expect(result.status).toBe('FAILED');
    });

    it('returns PENDING when transfer is still in progress', async () => {
      mockGetTransfer.mockResolvedValueOnce({
        status: 200,
        data: { id: 'alpaca-t-1', status: 'QUEUED', amount: '10000', direction: 'INCOMING' },
      });

      const result = await handler({
        action: 'poll',
        tenantId: 'tenant-1',
        nestfolioTransferId: 'nf-t-1',
        alpacaTransferId: 'alpaca-t-1',
        backoffSeconds: 60,
      });

      expect(result.status).toBe('PENDING');
    });

    it('throws on 429 or 5xx to trigger SF retry', async () => {
      mockGetTransfer.mockResolvedValueOnce({ status: 500, data: {} });

      await expect(handler({
        action: 'poll',
        tenantId: 'tenant-1',
        nestfolioTransferId: 'nf-t-1',
        alpacaTransferId: 'alpaca-t-1',
        backoffSeconds: 60,
      })).rejects.toThrow('Alpaca API error: 500');
    });
  });

  describe('action: write', () => {
    it('updates transfer status in DynamoDB', async () => {
      await handler({
        action: 'write',
        tenantId: 'tenant-1',
        nestfolioTransferId: 'nf-t-1',
        alpacaTransferId: 'alpaca-t-1',
        status: 'COMPLETED',
        backoffSeconds: 60,
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Key: { pk: 'TransferMapping#tenant-1#nf-t-1', sk: 'TransferMapping' },
          }),
        }),
      );
    });
  });

  describe('action: timeout', () => {
    it('writes FAILED with polling timeout reason', async () => {
      await handler({
        action: 'timeout',
        tenantId: 'tenant-1',
        nestfolioTransferId: 'nf-t-1',
        alpacaTransferId: 'alpaca-t-1',
        backoffSeconds: 14400,
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Key: { pk: 'TransferMapping#tenant-1#nf-t-1', sk: 'TransferMapping' },
          }),
        }),
      );
    });
  });
});
