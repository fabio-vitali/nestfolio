// Set env vars BEFORE any imports
process.env.TABLE_NAME = 'test-table';

const mockDdbSend = jest.fn();
const mockSfnSend = jest.fn();

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

jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn().mockImplementation(() => ({ send: mockSfnSend })),
  SendTaskSuccessCommand: jest.fn().mockImplementation((input) => ({ _type: 'SendTaskSuccess', input })),
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
  },
  requireEnv: (name: string) => process.env[name] ?? name,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

import { handler } from '../src/handlers/callback-resolver';
import type { SQSEvent } from 'aws-lambda';

function makeSqsEvent(records: Array<{ detailType: string; detail: Record<string, unknown> }>): SQSEvent {
  return {
    Records: records.map((r, i) => ({
      messageId: `msg-${i}`,
      receiptHandle: `handle-${i}`,
      body: JSON.stringify({
        'detail-type': r.detailType,
        detail: JSON.stringify(r.detail),
      }),
      attributes: {} as any,
      messageAttributes: {},
      md5OfBody: '',
      eventSource: 'aws:sqs',
      eventSourceARN: '',
      awsRegion: 'us-east-1',
    })),
  };
}

describe('callback-resolver handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSfnSend.mockResolvedValue({});
  });

  it('SIM_ORDER_FILLED → looks up taskToken → SendTaskSuccess with FILLED', async () => {
    // getOrder returns record with fillTaskToken
    mockDdbSend.mockResolvedValueOnce({ Item: { fillTaskToken: 'token-abc' } });

    const event = makeSqsEvent([{
      detailType: 'SIM_ORDER_FILLED',
      detail: { tenantId: 't-1', subject: { orderId: 'order-1', filledQuantity: 10, averageFillPrice: 250.50 } },
    }]);

    await handler(event);

    expect(mockSfnSend).toHaveBeenCalledTimes(1);
    const sfnCall = mockSfnSend.mock.calls[0][0];
    const output = JSON.parse(sfnCall.input.output);
    expect(sfnCall.input.taskToken).toBe('token-abc');
    expect(output.status).toBe('FILLED');
    expect(output.failureClass).toBe('none');
    expect(output.filledQty).toBe(10);
  });

  it('ALPACA_ORDER_REJECTED with insufficient funds → deterministic failure', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: { fillTaskToken: 'token-def' } });

    const event = makeSqsEvent([{
      detailType: 'ALPACA_ORDER_REJECTED',
      detail: { tenantId: 't-1', subject: { orderId: 'order-2', rejectionReason: 'insufficient buying power' } },
    }]);

    await handler(event);

    const sfnCall = mockSfnSend.mock.calls[0][0];
    const output = JSON.parse(sfnCall.input.output);
    expect(output.status).toBe('REJECTED');
    expect(output.failureClass).toBe('deterministic');
  });

  it('ALPACA_ORDER_REJECTED with 5xx error → transient failure', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: { fillTaskToken: 'token-ghi' } });

    const event = makeSqsEvent([{
      detailType: 'ALPACA_ORDER_REJECTED',
      detail: { tenantId: 't-1', subject: { orderId: 'order-3', rejectionReason: '503 service unavailable' } },
    }]);

    await handler(event);

    const sfnCall = mockSfnSend.mock.calls[0][0];
    const output = JSON.parse(sfnCall.input.output);
    expect(output.failureClass).toBe('transient');
  });

  it('ALPACA_ORDER_PARTIALLY_FILLED → PARTIALLY_FILLED status', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: { fillTaskToken: 'token-jkl' } });

    const event = makeSqsEvent([{
      detailType: 'ALPACA_ORDER_PARTIALLY_FILLED',
      detail: { tenantId: 't-1', subject: { orderId: 'order-4', filledQuantity: 5 } },
    }]);

    await handler(event);

    const sfnCall = mockSfnSend.mock.calls[0][0];
    const output = JSON.parse(sfnCall.input.output);
    expect(output.status).toBe('PARTIALLY_FILLED');
    expect(output.filledQty).toBe(5);
  });

  it('No taskToken found → logs warning, does not call SFN', async () => {
    // getOrder returns no fillTaskToken
    mockDdbSend.mockResolvedValueOnce({ Item: null });

    const event = makeSqsEvent([{
      detailType: 'SIM_ORDER_FILLED',
      detail: { tenantId: 't-1', subject: { orderId: 'order-missing' } },
    }]);

    await handler(event);

    expect(mockSfnSend).not.toHaveBeenCalled();
  });

  it('ALPACA_ACCOUNT_SNAPSHOT → looks up healTaskToken from CircuitBreaker', async () => {
    // getBreaker returns record with healTaskToken
    mockDdbSend.mockResolvedValueOnce({ Item: { healTaskToken: 'heal-token-xyz' } });

    const event = makeSqsEvent([{
      detailType: 'ALPACA_ACCOUNT_SNAPSHOT',
      detail: { tenantId: 't-1', subject: { equity: 50000, positions: [] } },
    }]);

    await handler(event);

    expect(mockSfnSend).toHaveBeenCalledTimes(1);
    const sfnCall = mockSfnSend.mock.calls[0][0];
    expect(sfnCall.input.taskToken).toBe('heal-token-xyz');
    const output = JSON.parse(sfnCall.input.output);
    expect(output.status).toBe('SNAPSHOT_RECEIVED');
  });
});
