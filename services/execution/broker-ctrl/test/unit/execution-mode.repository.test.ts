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

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
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
}));

import { ExecutionModeRepository } from '../../src/repositories/execution-mode.repository';

const TABLE_NAME = 'broker-ctrl-table';
const TENANT_ID = 'tenant-123';
const FIXED_TIME = '2025-01-01T00:00:00.000Z';

describe('ExecutionModeRepository', () => {
  let repo: ExecutionModeRepository;

  beforeEach(() => {
    mockSend.mockReset();
    repo = new ExecutionModeRepository(TABLE_NAME);
  });

  it('upsertMode — writes/updates ExecutionMode record', async () => {
    mockSend.mockResolvedValueOnce({});

    await repo.upsertMode(TENANT_ID, 'live');

    expect(mockSend).toHaveBeenCalledTimes(1);
    const [cmd] = mockSend.mock.calls[0];
    expect(cmd._type).toBe('Put');
    expect(cmd.input.Item).toMatchObject({
      pk: `ExecutionMode#${TENANT_ID}`,
      sk: 'ExecutionMode',
      __typename: 'ExecutionMode',
      tenantId: TENANT_ID,
      mode: 'live',
      updatedAt: FIXED_TIME,
    });
  });

  it('getMode — returns mode value', async () => {
    mockSend.mockResolvedValueOnce({ Item: { pk: `ExecutionMode#${TENANT_ID}`, sk: 'ExecutionMode', mode: 'live' } });

    const result = await repo.getMode(TENANT_ID);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const [cmd] = mockSend.mock.calls[0];
    expect(cmd._type).toBe('Get');
    expect(cmd.input.TableName).toBe(TABLE_NAME);
    expect(cmd.input.Key).toEqual({
      pk: `ExecutionMode#${TENANT_ID}`,
      sk: 'ExecutionMode',
    });
    expect(result).toBe('live');
  });

  it("getMode — returns 'simulation' as default when no record exists", async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const result = await repo.getMode(TENANT_ID);

    expect(result).toBe('simulation');
  });
});
