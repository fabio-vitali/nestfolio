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
    DynamoDBDocumentClient: { from: jest.fn().mockImplementation(() => ({ send: mockDdbSend })) },
    GetCommand: jest.fn().mockImplementation((input) => ({ _type: 'Get', input })),
    PutCommand: jest.fn().mockImplementation((input) => ({ _type: 'Put', input })),
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
  },
  requireEnv: (name: string) => process.env[name] ?? name,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

import { fakeSqsRecord } from '@nestfolio/event-processor';
import { handler } from '../src/handlers/deposit-withdrawal-router';
import { BrokerCtrlInboundEventTypes } from '../src/domain/events';
import type { SQSEvent } from 'aws-lambda';

function makeSqsEvent(...records: ReturnType<typeof fakeSqsRecord>[]): SQSEvent {
  return { Records: records };
}

describe('deposit-withdrawal-router handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEbSend.mockResolvedValue({});
  });

  describe('DEPOSIT_INITIATED', () => {
    it('routes to SIM_DEPOSIT_INITIATED when mode=simulation', async () => {
      mockDdbSend.mockResolvedValue({ Item: { mode: 'simulation' } });

      const event = makeSqsEvent(
        fakeSqsRecord(
          BrokerCtrlInboundEventTypes.DEPOSIT_INITIATED,
          { amount: 1000, currency: 'USD' },
          { tenantId: 't-1' },
        ),
      );

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockEbSend).toHaveBeenCalledTimes(1);
      const ebCall = mockEbSend.mock.calls[0][0];
      expect(ebCall.input.Entries[0]).toMatchObject({
        EventBusName: 'test-bus',
        Source: 'test-bus@broker-ctrl',
        DetailType: 'SIM_DEPOSIT_INITIATED',
      });
      const detail = JSON.parse(ebCall.input.Entries[0].Detail);
      expect(detail.context.tenantId).toBe('t-1');
      expect(detail.subject.direction).toBe('INCOMING');
      expect(detail.type).toBe('SIM_DEPOSIT_INITIATED');
    });

    it('routes to ALPACA_TRANSFER_REQUESTED with direction=INCOMING when mode=live', async () => {
      mockDdbSend.mockResolvedValue({ Item: { mode: 'live' } });

      const event = makeSqsEvent(
        fakeSqsRecord(
          BrokerCtrlInboundEventTypes.DEPOSIT_INITIATED,
          { amount: 5000, currency: 'USD' },
          { tenantId: 't-2' },
        ),
      );

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockEbSend).toHaveBeenCalledTimes(1);
      const ebCall = mockEbSend.mock.calls[0][0];
      expect(ebCall.input.Entries[0]).toMatchObject({
        EventBusName: 'test-bus',
        Source: 'test-bus@broker-ctrl',
        DetailType: 'ALPACA_TRANSFER_REQUESTED',
      });
      const detail = JSON.parse(ebCall.input.Entries[0].Detail);
      expect(detail.context.tenantId).toBe('t-2');
      expect(detail.subject.direction).toBe('INCOMING');
    });

    it('emits standard event envelope with id, type, timestamp, subject, context', async () => {
      mockDdbSend.mockResolvedValue({ Item: { mode: 'simulation' } });

      const event = makeSqsEvent(
        fakeSqsRecord(
          BrokerCtrlInboundEventTypes.DEPOSIT_INITIATED,
          { amount: 1000 },
          { tenantId: 't-envelope', userId: 'u-envelope', region: 'us-east-1' },
        ),
      );

      await handler(event);

      const detail = JSON.parse(mockEbSend.mock.calls[0][0].input.Entries[0].Detail);
      expect(detail).toEqual(expect.objectContaining({
        id: expect.any(String),
        type: 'SIM_DEPOSIT_INITIATED',
        timestamp: expect.any(String),
        subject: expect.objectContaining({ direction: 'INCOMING' }),
        context: { tenantId: 't-envelope', userId: 'u-envelope', region: 'us-east-1' },
      }));
    });
  });

  describe('WITHDRAWAL_REQUESTED', () => {
    it('routes to SIM_WITHDRAWAL_REQUESTED when mode=simulation', async () => {
      mockDdbSend.mockResolvedValue({ Item: { mode: 'simulation' } });

      const event = makeSqsEvent(
        fakeSqsRecord(
          BrokerCtrlInboundEventTypes.WITHDRAWAL_REQUESTED,
          { amount: 500, currency: 'USD' },
          { tenantId: 't-3' },
        ),
      );

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockEbSend).toHaveBeenCalledTimes(1);
      const ebCall = mockEbSend.mock.calls[0][0];
      expect(ebCall.input.Entries[0]).toMatchObject({
        EventBusName: 'test-bus',
        Source: 'test-bus@broker-ctrl',
        DetailType: 'SIM_WITHDRAWAL_REQUESTED',
      });
      const detail = JSON.parse(ebCall.input.Entries[0].Detail);
      expect(detail.context.tenantId).toBe('t-3');
      expect(detail.subject.direction).toBe('OUTGOING');
    });

    it('routes to ALPACA_TRANSFER_REQUESTED with direction=OUTGOING when mode=live', async () => {
      mockDdbSend.mockResolvedValue({ Item: { mode: 'live' } });

      const event = makeSqsEvent(
        fakeSqsRecord(
          BrokerCtrlInboundEventTypes.WITHDRAWAL_REQUESTED,
          { amount: 2000, currency: 'USD' },
          { tenantId: 't-4' },
        ),
      );

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockEbSend).toHaveBeenCalledTimes(1);
      const ebCall = mockEbSend.mock.calls[0][0];
      expect(ebCall.input.Entries[0]).toMatchObject({
        EventBusName: 'test-bus',
        Source: 'test-bus@broker-ctrl',
        DetailType: 'ALPACA_TRANSFER_REQUESTED',
      });
      const detail = JSON.parse(ebCall.input.Entries[0].Detail);
      expect(detail.context.tenantId).toBe('t-4');
      expect(detail.subject.direction).toBe('OUTGOING');
    });
  });
});
