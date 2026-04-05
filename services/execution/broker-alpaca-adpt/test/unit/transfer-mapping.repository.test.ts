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
    QueryCommand: jest.fn().mockImplementation((input) => ({ _type: 'Query', input })),
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
      protected async queryAll(input: unknown) {
        const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
        const result = await this.docClient.send(new QueryCommand(input));
        return result.Items ?? [];
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

import { TransferMappingRepository } from '../../src/repositories/transfer-mapping.repository';

const TABLE_NAME = 'test-table';
const TENANT_ID = 'tenant-1';
const NESTFOLIO_TRANSFER_ID = 'nf-transfer-123';
const ALPACA_TRANSFER_ID = 'alpaca-transfer-456';
const FIXED_TIME = '2025-01-01T00:00:00.000Z';

describe('TransferMappingRepository', () => {
  let repo: TransferMappingRepository;

  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
    repo = new TransferMappingRepository(TABLE_NAME);
  });

  describe('createMapping', () => {
    it('writes TransferMapping record with INITIATED status', async () => {
      await repo.createMapping(TENANT_ID, NESTFOLIO_TRANSFER_ID, ALPACA_TRANSFER_ID, 'INCOMING', 5000);

      const putCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Put');
      expect(putCalls).toHaveLength(1);

      const item = putCalls[0][0].input.Item;
      expect(item.pk).toBe(`TransferMapping#${TENANT_ID}#${NESTFOLIO_TRANSFER_ID}`);
      expect(item.sk).toBe('TransferMapping');
      expect(item.__typename).toBe('AlpacaTransferResult');
      expect(item.tenantId).toBe(TENANT_ID);
      expect(item.nestfolioTransferId).toBe(NESTFOLIO_TRANSFER_ID);
      expect(item.alpacaTransferId).toBe(ALPACA_TRANSFER_ID);
      expect(item.direction).toBe('INCOMING');
      expect(item.amount).toBe(5000);
      expect(item.status).toBe('INITIATED');
      expect(item.timestamp).toBe(FIXED_TIME);
    });
  });

  describe('getPendingTransfers', () => {
    it('queries PendingTransfers pk with INITIATED filter', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await repo.getPendingTransfers(TENANT_ID);

      const queryCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Query');
      expect(queryCalls).toHaveLength(1);
      const queryInput = queryCalls[0][0] as { input: Record<string, unknown> };
      expect(queryInput.input.ExpressionAttributeValues).toMatchObject({
        ':pk': `PendingTransfers#${TENANT_ID}`,
        ':pending': 'INITIATED',
      });
      expect(result).toEqual([]);
    });
  });

  describe('updateStatus', () => {
    it('sends UpdateCommand with new status and updatedAt', async () => {
      await repo.updateStatus(TENANT_ID, NESTFOLIO_TRANSFER_ID, 'COMPLETED');

      const updateCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Update');
      expect(updateCalls).toHaveLength(1);
      const updateInput = updateCalls[0][0].input;
      expect(updateInput.Key).toEqual({
        pk: `TransferMapping#${TENANT_ID}#${NESTFOLIO_TRANSFER_ID}`,
        sk: 'TransferMapping',
      });
      const values = Object.values(updateInput.ExpressionAttributeValues as Record<string, unknown>);
      expect(values).toContain('COMPLETED');
      expect(values).toContain(FIXED_TIME);
    });

    it('merges additional updates', async () => {
      await repo.updateStatus(TENANT_ID, NESTFOLIO_TRANSFER_ID, 'FAILED', { failureReason: 'Insufficient funds' });

      const updateCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Update');
      expect(updateCalls).toHaveLength(1);
      const values = Object.values(updateCalls[0][0].input.ExpressionAttributeValues as Record<string, unknown>);
      expect(values).toContain('Insufficient funds');
    });

    it('includes ConditionExpression to prevent duplicate status writes', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateStatus('tenant-1', 'nf-transfer-1', 'COMPLETED', {});

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

      await expect(repo.updateStatus('tenant-1', 'nf-transfer-1', 'COMPLETED')).resolves.not.toThrow();
    });
  });
});
