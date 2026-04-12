const mockSend = jest.fn();
const mockEbSend = jest.fn();

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

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockEbSend })),
  PutEventsCommand: jest.fn().mockImplementation((input) => ({ _type: 'PutEvents', input })),
}));

process.env.TABLE_NAME = 'test-table';
process.env.BUS_NAME = 'test-bus';

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
  },
  requireEnv: (name: string) => process.env[name] ?? name,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

import { handler, type RouteOrderEvent } from '../src/handlers/route-order';

describe('route-order handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockEbSend.mockResolvedValue({});
  });

  const baseOrder = {
    tenantId: 't-1',
    orderId: 'order-1',
    userId: 'u-1',
    symbol: 'VTI',
    side: 'BUY' as const,
    quantity: 10,
  };

  it('should route to simulation adapter when executionMode=simulation', async () => {
    const event: RouteOrderEvent = {
      order: baseOrder,
      executionMode: 'simulation',
      taskToken: 'token-123',
    };

    await handler(event);

    // Verify DDB write
    expect(mockSend).toHaveBeenCalledTimes(1);
    const putCall = mockSend.mock.calls[0][0];
    expect(putCall.input.Item).toMatchObject({
      __typename: 'BrokerOrder',
      state: 'AWAITING_FILL',
      routedTo: 'sim',
      fillTaskToken: 'token-123',
    });

    // Verify EventBridge emit
    expect(mockEbSend).toHaveBeenCalledTimes(1);
    const ebCall = mockEbSend.mock.calls[0][0];
    expect(ebCall.input.Entries[0]).toMatchObject({
      EventBusName: 'test-bus',
      Source: 'test-bus@broker-ctrl',
      DetailType: 'SIM_ORDER_REQUESTED',
    });
  });

  it('should route to alpaca adapter when executionMode=live', async () => {
    const event: RouteOrderEvent = {
      order: baseOrder,
      executionMode: 'live',
      taskToken: 'token-456',
    };

    await handler(event);

    // Verify DDB write
    const putCall = mockSend.mock.calls[0][0];
    expect(putCall.input.Item).toMatchObject({
      routedTo: 'alpaca',
      executionMode: 'live',
    });

    // Verify EventBridge emit
    const ebCall = mockEbSend.mock.calls[0][0];
    expect(ebCall.input.Entries[0].DetailType).toBe('ALPACA_ORDER_REQUESTED');
  });

  it('should include order details in EventBridge event payload', async () => {
    const event: RouteOrderEvent = {
      order: baseOrder,
      executionMode: 'simulation',
      taskToken: 'token-789',
    };

    await handler(event);

    const ebCall = mockEbSend.mock.calls[0][0];
    const detail = JSON.parse(ebCall.input.Entries[0].Detail);
    expect(detail.context.tenantId).toBe('t-1');
    expect(detail.type).toBe('SIM_ORDER_REQUESTED');
    expect(detail.subject).toMatchObject({
      orderId: 'order-1',
      symbol: 'VTI',
      side: 'BUY',
      quantity: 10,
    });
  });
});
