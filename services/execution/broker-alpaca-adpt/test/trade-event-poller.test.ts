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
  const ddb = jest.requireMock('@aws-sdk/lib-dynamodb') as {
    PutCommand: jest.Mock;
    GetCommand: jest.Mock;
    UpdateCommand: jest.Mock;
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
    },
    requireEnv: (name: string) => process.env[name] ?? name,
    withMethodLogging: jest.fn((_className: string) =>
      (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
    ),
    getTime: jest.fn().mockReturnValue('2025-01-01T12:00:00.000Z'),
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  };
});

const mockGetTradeEvents = jest.fn();

jest.mock('../src/clients/alpaca.client', () => ({
  AlpacaClient: jest.fn().mockImplementation(() => ({
    getTradeEvents: mockGetTradeEvents,
  })),
}));

process.env.TABLE_NAME = 'test-table';

import { processTradeEventsForTenant } from '../src/handlers/trade-event-poller';
import { OrderMappingRepository } from '../src/repositories/order-mapping.repository';
import { PollingStateRepository } from '../src/repositories/polling-state.repository';

describe('trade-event-poller', () => {
  let _orderRepo: OrderMappingRepository;
  let _pollingRepo: PollingStateRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    _orderRepo = new OrderMappingRepository('test-table');
    _pollingRepo = new PollingStateRepository('test-table');
  });

  it('polls events, matches to order mapping, updates status to FILLED', async () => {
    // pollingState: 1 open order, lastCheckedAt set
    mockSend.mockImplementation((cmd: { _type: string; input: any }) => {
      if (cmd._type === 'Get') {
        const pk: string = cmd.input?.Key?.pk ?? '';
        if (pk.startsWith('PollingState#')) {
          return { Item: { pk, sk: 'PollingState', openOrderCount: 1, lastCheckedAt: '2025-01-01T11:00:00.000Z' } };
        }
        if (pk.startsWith('AlpacaOrder#')) {
          return { Item: { pk, sk: 'OrderMapping', nestfolioOrderId: 'nf-order-1', alpacaOrderId: 'alpaca-order-abc' } };
        }
      }
      return {};
    });

    mockGetTradeEvents.mockResolvedValue({
      status: 200,
      data: [
        { event: 'fill', order: { id: 'alpaca-order-abc' }, qty: '10', price: '150.00' },
      ],
    });

    await processTradeEventsForTenant('tenant-1');

    expect(mockGetTradeEvents).toHaveBeenCalledWith('2025-01-01T11:00:00.000Z', '2025-01-01T12:00:00.000Z');
    // updateStatus called for the order (UPDATE command)
    const updateCalls = mockSend.mock.calls.filter((c: any[]) => c[0]?._type === 'Update');
    const orderUpdate = updateCalls.find((c: any[]) =>
      c[0].input?.Key?.pk === 'OrderMapping#tenant-1#nf-order-1',
    );
    expect(orderUpdate).toBeDefined();
    expect(orderUpdate[0].input.ExpressionAttributeValues).toMatchObject(
      expect.objectContaining({ ':v0': 'FILLED' }),
    );
    // decrementOpenOrderCount called (UpdateCommand with ADD)
    const decrementCall = mockSend.mock.calls.find((c: any[]) =>
      c[0]?.input?.Key?.pk === 'PollingState#tenant-1' &&
      c[0]?.input?.UpdateExpression?.includes('ADD'),
    );
    expect(decrementCall).toBeDefined();
    // updateLastCheckedAt called
    const lastCheckedUpdate = updateCalls.find((c: any[]) =>
      c[0].input?.Key?.pk === 'PollingState#tenant-1',
    );
    expect(lastCheckedUpdate).toBeDefined();
  });

  it('no new events → only updates lastCheckedAt', async () => {
    mockSend.mockImplementation((cmd: { _type: string; input: any }) => {
      if (cmd._type === 'Get') {
        const pk: string = cmd.input?.Key?.pk ?? '';
        if (pk.startsWith('PollingState#')) {
          return { Item: { pk, sk: 'PollingState', openOrderCount: 1, lastCheckedAt: '2025-01-01T11:00:00.000Z' } };
        }
      }
      return {};
    });

    mockGetTradeEvents.mockResolvedValue({ status: 200, data: [] });

    await processTradeEventsForTenant('tenant-1');

    expect(mockGetTradeEvents).toHaveBeenCalled();
    // Only updateLastCheckedAt should fire — no order update commands
    const updateCalls = mockSend.mock.calls.filter((c: any[]) => c[0]?._type === 'Update');
    const orderUpdate = updateCalls.find((c: any[]) =>
      c[0].input?.Key?.pk?.startsWith('OrderMapping#'),
    );
    expect(orderUpdate).toBeUndefined();
    const lastCheckedUpdate = updateCalls.find((c: any[]) =>
      c[0].input?.Key?.pk === 'PollingState#tenant-1',
    );
    expect(lastCheckedUpdate).toBeDefined();
  });

  it('zero open orders → returns early without calling getTradeEvents', async () => {
    mockSend.mockImplementation((cmd: { _type: string; input: any }) => {
      if (cmd._type === 'Get') {
        const pk: string = cmd.input?.Key?.pk ?? '';
        if (pk.startsWith('PollingState#')) {
          return { Item: { pk, sk: 'PollingState', openOrderCount: 0 } };
        }
      }
      return {};
    });

    await processTradeEventsForTenant('tenant-1');

    expect(mockGetTradeEvents).not.toHaveBeenCalled();
  });
});
