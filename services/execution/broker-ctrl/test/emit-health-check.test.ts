// Set env vars BEFORE any imports
process.env.TABLE_NAME = 'test-table';
process.env.BUS_NAME = 'test-bus';

const mockDdbSend = jest.fn();
const mockEbSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockDdbSend })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: jest.fn().mockImplementation(() => ({ send: mockDdbSend })),
    },
    GetCommand: jest.fn().mockImplementation((input) => ({ _type: 'Get', input })),
    PutCommand: jest.fn().mockImplementation((input) => ({ _type: 'Put', input })),
    UpdateCommand: jest.fn().mockImplementation((input) => ({ _type: 'Update', input })),
  };
});

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockEbSend })),
  PutEventsCommand: jest.fn().mockImplementation((input) => ({ _type: 'PutEvents', input })),
}));

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  TableRepository: class {
    protected readonly docClient: { send: jest.Mock };
    protected readonly tableName: string;
    constructor(tableName: string) {
      this.tableName = tableName;
      this.docClient = { send: mockDdbSend };
    }
    protected async put(item: Record<string, unknown>) {
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item }));
    }
    protected async update(pk: string, sk: string, attrs: Record<string, unknown>) {
      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk },
        ...attrs,
      }));
    }
  },
  requireEnv: (name: string) => process.env[name] ?? name,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

import { handler, EmitHealthCheckEvent } from '../src/handlers/emit-health-check';

describe('emit-health-check handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDdbSend.mockResolvedValue({});
    mockEbSend.mockResolvedValue({});
  });

  it('stores healTaskToken and emits ALPACA_ACCOUNT_CHECK', async () => {
    const event: EmitHealthCheckEvent = {
      tenantId: 't-1',
      symbol: 'Global',
      taskToken: 'heal-token-123',
      attemptCount: 0,
    };

    await handler(event);

    // Verify DDB update was called (storeHealTaskToken)
    expect(mockDdbSend).toHaveBeenCalledTimes(1);
    const ddbCall = mockDdbSend.mock.calls[0][0];
    expect(ddbCall.input.Key.pk).toBe('CircuitBreaker#t-1#Global');
    expect(ddbCall.input.Key.sk).toBe('CircuitBreaker');

    // Verify EventBridge PutEvents was called
    expect(mockEbSend).toHaveBeenCalledTimes(1);
    const ebCall = mockEbSend.mock.calls[0][0];
    expect(ebCall.input.Entries[0].DetailType).toBe('ALPACA_ACCOUNT_CHECK');
    expect(ebCall.input.Entries[0].EventBusName).toBe('test-bus');
    expect(ebCall.input.Entries[0].Source).toBe('broker-ctrl');

    const detail = JSON.parse(ebCall.input.Entries[0].Detail);
    expect(detail.tenantId).toBe('t-1');
    expect(detail.subject.symbol).toBe('Global');
  });

  it('passes through different tenantId and symbol values', async () => {
    const event: EmitHealthCheckEvent = {
      tenantId: 't-42',
      symbol: 'AAPL',
      taskToken: 'heal-token-456',
      attemptCount: 3,
    };

    await handler(event);

    const ddbCall = mockDdbSend.mock.calls[0][0];
    expect(ddbCall.input.Key.pk).toBe('CircuitBreaker#t-42#AAPL');

    const ebCall = mockEbSend.mock.calls[0][0];
    const detail = JSON.parse(ebCall.input.Entries[0].Detail);
    expect(detail.tenantId).toBe('t-42');
    expect(detail.subject.symbol).toBe('AAPL');
  });
});
