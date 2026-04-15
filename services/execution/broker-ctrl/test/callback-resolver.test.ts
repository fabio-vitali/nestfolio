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
}));

import { handler } from '../src/handlers/callback-resolver';
import { fakeSqsRecord } from '@nestfolio/event-processor';

describe('callback-resolver handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSfnSend.mockResolvedValue({});
    mockDdbSend.mockResolvedValue({});
  });

  it('SIM_ORDER_FILLED → looks up taskToken → SendTaskSuccess with FILLED', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: { fillTaskToken: 'token-abc' } });

    const record = fakeSqsRecord('SIM_ORDER_FILLED', {
      orderId: 'order-1', filledQuantity: 10, averageFillPrice: 250.50,
    }, { eventId: 'evt-1', tenantId: 't-1' });

    const result = await handler({ Records: [record] });

    expect(result.batchItemFailures).toHaveLength(0);
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

    const record = fakeSqsRecord('ALPACA_ORDER_REJECTED', {
      orderId: 'order-2', rejectionReason: 'insufficient buying power',
    }, { eventId: 'evt-2', tenantId: 't-1' });

    const result = await handler({ Records: [record] });

    expect(result.batchItemFailures).toHaveLength(0);
    const sfnCall = mockSfnSend.mock.calls[0][0];
    const output = JSON.parse(sfnCall.input.output);
    expect(output.status).toBe('REJECTED');
    expect(output.failureClass).toBe('deterministic');
  });

  it('ALPACA_ORDER_REJECTED with 5xx error → transient failure', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: { fillTaskToken: 'token-ghi' } });

    const record = fakeSqsRecord('ALPACA_ORDER_REJECTED', {
      orderId: 'order-3', rejectionReason: '503 service unavailable',
    }, { eventId: 'evt-3', tenantId: 't-1' });

    const result = await handler({ Records: [record] });

    expect(result.batchItemFailures).toHaveLength(0);
    const sfnCall = mockSfnSend.mock.calls[0][0];
    const output = JSON.parse(sfnCall.input.output);
    expect(output.failureClass).toBe('transient');
  });

  it('ALPACA_ORDER_PARTIALLY_FILLED → PARTIALLY_FILLED status', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: { fillTaskToken: 'token-jkl' } });

    const record = fakeSqsRecord('ALPACA_ORDER_PARTIALLY_FILLED', {
      orderId: 'order-4', filledQuantity: 5,
    }, { eventId: 'evt-4', tenantId: 't-1' });

    const result = await handler({ Records: [record] });

    expect(result.batchItemFailures).toHaveLength(0);
    const sfnCall = mockSfnSend.mock.calls[0][0];
    const output = JSON.parse(sfnCall.input.output);
    expect(output.status).toBe('PARTIALLY_FILLED');
    expect(output.filledQty).toBe(5);
  });

  it('No taskToken found → logs warning, does not call SFN', async () => {
    mockDdbSend.mockResolvedValueOnce({ Item: null });

    const record = fakeSqsRecord('SIM_ORDER_FILLED', {
      orderId: 'order-missing',
    }, { eventId: 'evt-5', tenantId: 't-1' });

    const result = await handler({ Records: [record] });

    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockSfnSend).not.toHaveBeenCalled();
  });


});
