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

import { BrokerOrderRepository, CreateOrderParams } from '../../src/repositories/broker-order.repository';

const TABLE_NAME = 'broker-ctrl-table';
const TENANT_ID = 'tenant-123';
const ORDER_ID = 'order-456';
const FIXED_TIME = '2025-01-01T00:00:00.000Z';

describe('BrokerOrderRepository', () => {
  let repo: BrokerOrderRepository;

  beforeEach(() => {
    mockSend.mockReset();
    repo = new BrokerOrderRepository(TABLE_NAME);
  });

  it('createOrder — writes BrokerOrder with state=AWAITING_FILL', async () => {
    mockSend.mockResolvedValueOnce({});

    const params: CreateOrderParams = {
      tenantId: TENANT_ID,
      orderId: ORDER_ID,
      executionMode: 'PAPER',
      routedTo: 'alpaca',
      requestedAmountCents: 50000,
      instrumentId: 'AAPL',
      fillTaskToken: 'token-abc',
    };

    await repo.createOrder(params);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const [cmd] = mockSend.mock.calls[0];
    expect(cmd._type).toBe('Put');
    expect(cmd.input.Item).toMatchObject({
      pk: `BrokerOrder#${TENANT_ID}#${ORDER_ID}`,
      sk: 'BrokerOrder',
      __typename: 'BrokerOrder',
      state: 'AWAITING_FILL',
      tenantId: TENANT_ID,
      orderId: ORDER_ID,
      executionMode: 'PAPER',
      routedTo: 'alpaca',
      fillTaskToken: 'token-abc',
      requestedAmountCents: 50000,
      filledQty: 0,
      retryCount: 0,
      instrumentId: 'AAPL',
      routedAt: FIXED_TIME,
    });
  });

  it('updateOrderState — transitions state and updates fields', async () => {
    mockSend.mockResolvedValueOnce({});

    await repo.updateOrderState(TENANT_ID, ORDER_ID, 'FILLED', { filledQty: 10, retryCount: 0 });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const [cmd] = mockSend.mock.calls[0];
    expect(cmd._type).toBe('Update');
    expect(cmd.input.Key).toEqual({
      pk: `BrokerOrder#${TENANT_ID}#${ORDER_ID}`,
      sk: 'BrokerOrder',
    });
    // Verify the update includes state, extra fields, and updatedAt
    const attrValues = Object.values(cmd.input.ExpressionAttributeValues as Record<string, unknown>);
    expect(attrValues).toContain('FILLED');
    expect(attrValues).toContain(10);
    expect(attrValues).toContain(0);
    expect(attrValues).toContain(FIXED_TIME);
  });

  it('getOrder — reads by tenantId + orderId', async () => {
    const fakeItem = {
      pk: `BrokerOrder#${TENANT_ID}#${ORDER_ID}`,
      sk: 'BrokerOrder',
      state: 'AWAITING_FILL',
      fillTaskToken: 'token-abc',
    };
    mockSend.mockResolvedValueOnce({ Item: fakeItem });

    const result = await repo.getOrder(TENANT_ID, ORDER_ID);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const [cmd] = mockSend.mock.calls[0];
    expect(cmd._type).toBe('Get');
    expect(cmd.input.TableName).toBe(TABLE_NAME);
    expect(cmd.input.Key).toEqual({
      pk: `BrokerOrder#${TENANT_ID}#${ORDER_ID}`,
      sk: 'BrokerOrder',
    });
    expect(result).toEqual(fakeItem);
  });

  it('getOrder — returns null when item not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const result = await repo.getOrder(TENANT_ID, ORDER_ID);

    expect(result).toBeNull();
  });

  it('storeTaskToken — stores fillTaskToken on existing record', async () => {
    mockSend.mockResolvedValueOnce({});

    await repo.storeTaskToken(TENANT_ID, ORDER_ID, 'new-task-token');

    expect(mockSend).toHaveBeenCalledTimes(1);
    const [cmd] = mockSend.mock.calls[0];
    expect(cmd._type).toBe('Update');
    expect(cmd.input.Key).toEqual({
      pk: `BrokerOrder#${TENANT_ID}#${ORDER_ID}`,
      sk: 'BrokerOrder',
    });
    const attrValues = Object.values(cmd.input.ExpressionAttributeValues as Record<string, unknown>);
    expect(attrValues).toContain('new-task-token');
  });

  it('getTaskToken — reads fillTaskToken by orderId', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        pk: `BrokerOrder#${TENANT_ID}#${ORDER_ID}`,
        sk: 'BrokerOrder',
        fillTaskToken: 'stored-token-xyz',
      },
    });

    const token = await repo.getTaskToken(TENANT_ID, ORDER_ID);

    expect(token).toBe('stored-token-xyz');
  });
});
