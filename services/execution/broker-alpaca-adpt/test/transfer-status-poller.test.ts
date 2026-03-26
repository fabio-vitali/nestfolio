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
    QueryCommand: jest.fn().mockImplementation((input) => ({ _type: 'Query', input })),
  };
});

jest.mock('@nestfolio/event-processor', () => {
  const ddb = jest.requireMock('@aws-sdk/lib-dynamodb') as {
    PutCommand: jest.Mock;
    GetCommand: jest.Mock;
    UpdateCommand: jest.Mock;
    QueryCommand: jest.Mock;
  };
  return {
    ...jest.requireActual('@nestfolio/event-processor'),
    TableRepository: class {
      protected readonly docClient: { send: jest.Mock };
      protected readonly tableName: string;
      constructor(tableName: string) {
        this.tableName = tableName;
        this.docClient = { send: mockSend };
      }
      protected async put(item: Record<string, unknown>) {
        await this.docClient.send(new ddb.PutCommand({ TableName: this.tableName, Item: item }));
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
          TableName: this.tableName,
          Key: { pk, sk },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }));
      }
      protected async queryAll(params: Record<string, unknown>): Promise<Record<string, unknown>[]> {
        const result = await this.docClient.send(new ddb.QueryCommand(params)) as { Items?: Record<string, unknown>[] };
        return result?.Items ?? [];
      }
    },
    requireEnv: (name: string) => process.env[name] ?? name,
    withMethodLogging: jest.fn((_className: string) =>
      (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
    ),
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  };
});

const mockGetTransfer = jest.fn();

jest.mock('../src/clients/alpaca.client', () => ({
  AlpacaClient: jest.fn().mockImplementation(() => ({
    getTransfer: mockGetTransfer,
  })),
}));

process.env.TABLE_NAME = 'test-table';

import { processTransfersForTenant } from '../src/handlers/transfer-status-poller';

interface MockDdbCommand {
  _type: string;
  input?: { Key?: { pk?: string }; UpdateExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
}

describe('transfer-status-poller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('no pending transfers → no-op, does not call getTransfer', async () => {
    mockSend.mockResolvedValue({ Items: [] });

    await processTransfersForTenant('tenant-1');

    expect(mockGetTransfer).not.toHaveBeenCalled();
  });

  it('COMPLETE → updates status to COMPLETED', async () => {
    mockSend.mockImplementation((cmd: MockDdbCommand) => {
      if (cmd._type === 'Query') {
        return {
          Items: [
            {
              pk: 'TransferMapping#tenant-1#nf-transfer-1',
              sk: 'TransferMapping',
              nestfolioTransferId: 'nf-transfer-1',
              alpacaTransferId: 'alpaca-transfer-abc',
              status: 'INITIATED',
            },
          ],
        };
      }
      return {};
    });

    mockGetTransfer.mockResolvedValue({ status: 200, data: { status: 'COMPLETE' } });

    await processTransfersForTenant('tenant-1');

    expect(mockGetTransfer).toHaveBeenCalledWith('alpaca-transfer-abc');
    const updateCalls = mockSend.mock.calls.filter((c: [MockDdbCommand]) => c[0]?._type === 'Update');
    const statusUpdate = updateCalls.find((c: [MockDdbCommand]) =>
      c[0].input?.Key?.pk === 'TransferMapping#tenant-1#nf-transfer-1',
    );
    expect(statusUpdate).toBeDefined();
    expect(statusUpdate![0].input!.ExpressionAttributeValues).toMatchObject(
      expect.objectContaining({ ':v0': 'COMPLETED' }),
    );
  });

  it('REJECTED → updates status to FAILED with failureReason', async () => {
    mockSend.mockImplementation((cmd: MockDdbCommand) => {
      if (cmd._type === 'Query') {
        return {
          Items: [
            {
              pk: 'TransferMapping#tenant-1#nf-transfer-2',
              sk: 'TransferMapping',
              nestfolioTransferId: 'nf-transfer-2',
              alpacaTransferId: 'alpaca-transfer-xyz',
              status: 'INITIATED',
            },
          ],
        };
      }
      return {};
    });

    mockGetTransfer.mockResolvedValue({ status: 200, data: { status: 'REJECTED' } });

    await processTransfersForTenant('tenant-1');

    expect(mockGetTransfer).toHaveBeenCalledWith('alpaca-transfer-xyz');
    const updateCalls = mockSend.mock.calls.filter((c: [MockDdbCommand]) => c[0]?._type === 'Update');
    const statusUpdate = updateCalls.find((c: [MockDdbCommand]) =>
      c[0].input?.Key?.pk === 'TransferMapping#tenant-1#nf-transfer-2',
    );
    expect(statusUpdate).toBeDefined();
    expect(statusUpdate![0].input!.ExpressionAttributeValues).toMatchObject(
      expect.objectContaining({ ':v0': 'FAILED' }),
    );
    const values = statusUpdate![0].input!.ExpressionAttributeValues as Record<string, unknown>;
    const failureReason = Object.values(values).find(
      (v) => typeof v === 'string' && (v as string).includes('REJECTED'),
    );
    expect(failureReason).toBeDefined();
  });

  it('PENDING status → no update', async () => {
    mockSend.mockImplementation((cmd: MockDdbCommand) => {
      if (cmd._type === 'Query') {
        return {
          Items: [
            {
              pk: 'TransferMapping#tenant-1#nf-transfer-3',
              sk: 'TransferMapping',
              nestfolioTransferId: 'nf-transfer-3',
              alpacaTransferId: 'alpaca-transfer-pending',
              status: 'INITIATED',
            },
          ],
        };
      }
      return {};
    });

    mockGetTransfer.mockResolvedValue({ status: 200, data: { status: 'PENDING' } });

    await processTransfersForTenant('tenant-1');

    expect(mockGetTransfer).toHaveBeenCalledWith('alpaca-transfer-pending');
    const updateCalls = mockSend.mock.calls.filter((c: [MockDdbCommand]) => c[0]?._type === 'Update');
    expect(updateCalls).toHaveLength(0);
  });
});
