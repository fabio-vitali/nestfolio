/**
 * Integration tests: Order Lifecycle through the broker-ctrl handler chain.
 *
 * These tests call the actual handler functions in sequence to verify the
 * end-to-end handler chain that the Step Functions state machine orchestrates.
 * AWS SDK clients (DDB, EventBridge, SFN) are mocked at the module level.
 *
 * Scenarios:
 * 1. Happy path: ORDER_SUBMITTED → RouteOrder → SIM_ORDER_FILLED callback → FILLED
 * 2. Transient failure: RouteOrder → transient rejection → retry → eventual fill
 * 3. Deterministic rejection: RouteOrder → deterministic rejection → REJECTED
 * 4. Timeout / escalation: RouteOrder → no callback → taskToken already cleared
 */

// ── Mock setup (BEFORE any imports) ─────────────────────────────────────────
const mockDdbSend = jest.fn();
const mockEbSend = jest.fn();
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
    PutCommand: jest.fn().mockImplementation((input) => ({ _type: 'Put', input })),
    GetCommand: jest.fn().mockImplementation((input) => ({ _type: 'Get', input })),
    UpdateCommand: jest.fn().mockImplementation((input) => ({ _type: 'Update', input })),
  };
});

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockEbSend })),
  PutEventsCommand: jest.fn().mockImplementation((input) => ({ _type: 'PutEvents', input })),
}));

jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn().mockImplementation(() => ({ send: mockSfnSend })),
  SendTaskSuccessCommand: jest.fn().mockImplementation((input) => ({ _type: 'SendTaskSuccess', input })),
}));

process.env.TABLE_NAME = 'broker-ctrl-table';
process.env.BUS_NAME = 'execution-bus';

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
    protected async update(pk: string, sk: string, updates: Record<string, unknown>) {
      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(
        new UpdateCommand({ TableName: this.tableName, Key: { pk, sk }, ...updates }),
      );
    }
  },
  requireEnv: (name: string) => process.env[name] ?? name,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { handler as routeOrder, type RouteOrderEvent } from '../../src/handlers/route-order';
import { handler as callbackResolver } from '../../src/handlers/callback-resolver';
import type { SQSEvent } from 'aws-lambda';

// ── Helpers ─────────────────────────────────────────────────────────────────
function makeSqsEvent(
  records: Array<{ detailType: string; detail: Record<string, unknown> }>,
): SQSEvent {
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

const baseOrder = {
  tenantId: 't-1',
  orderId: 'order-100',
  userId: 'u-1',
  symbol: 'VTI',
  side: 'BUY' as const,
  quantity: 10,
};

/** Extract the Item written by the Nth DDB PutCommand call (0-indexed) */
function getPutItem(callIndex: number): Record<string, unknown> {
  const call = mockDdbSend.mock.calls[callIndex][0];
  expect(call._type).toBe('Put');
  return call.input.Item;
}

/** Extract the EventBridge entry from the Nth EB call (0-indexed) */
function getEbEntry(callIndex: number): Record<string, unknown> {
  const call = mockEbSend.mock.calls[callIndex][0];
  return call.input.Entries[0];
}

/** Extract the SFN SendTaskSuccess output from the Nth SFN call (0-indexed) */
function getSfnOutput(callIndex: number): { taskToken: string; output: Record<string, unknown> } {
  const call = mockSfnSend.mock.calls[callIndex][0];
  return {
    taskToken: call.input.taskToken,
    output: JSON.parse(call.input.output),
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────
describe('Order Lifecycle Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDdbSend.mockResolvedValue({});
    mockEbSend.mockResolvedValue({});
    mockSfnSend.mockResolvedValue({});
  });

  // ─── Scenario 1: Happy path (sim fill) ──────────────────────────────────
  describe('Scenario 1: ORDER_SUBMITTED → SIM_ORDER_FILLED → FILLED', () => {
    it('should route order to sim, then resolve callback with FILLED status', async () => {
      // Step 1: RouteOrder writes BrokerOrder + emits SIM_ORDER_REQUESTED
      const routeEvent: RouteOrderEvent = {
        order: baseOrder,
        executionMode: 'simulation',
        taskToken: 'task-token-001',
      };

      await routeOrder(routeEvent);

      // Verify BrokerOrder was written to DDB
      expect(mockDdbSend).toHaveBeenCalledTimes(1);
      const brokerOrder = getPutItem(0);
      expect(brokerOrder).toMatchObject({
        __typename: 'BrokerOrder',
        pk: 'BrokerOrder#t-1#order-100',
        sk: 'BrokerOrder',
        state: 'AWAITING_FILL',
        routedTo: 'sim',
        executionMode: 'simulation',
        fillTaskToken: 'task-token-001',
        requestedQty: 10,
        filledQty: 0,
        instrumentId: 'VTI',
      });

      // Verify EventBridge emission
      expect(mockEbSend).toHaveBeenCalledTimes(1);
      const ebEntry = getEbEntry(0);
      expect(ebEntry).toMatchObject({
        EventBusName: 'execution-bus',
        Source: 'broker-ctrl',
        DetailType: 'SIM_ORDER_REQUESTED',
      });
      const ebDetail = JSON.parse(ebEntry.Detail as string);
      expect(ebDetail.subject).toMatchObject({
        orderId: 'order-100',
        symbol: 'VTI',
        side: 'BUY',
        quantity: 10,
      });

      // Step 2: CallbackResolver receives SIM_ORDER_FILLED
      // Reset DDB mock for the callback phase — getTaskToken calls getOrder → GetCommand
      jest.clearAllMocks();
      mockSfnSend.mockResolvedValue({});
      // getOrder returns the BrokerOrder with fillTaskToken
      mockDdbSend.mockResolvedValueOnce({
        Item: { fillTaskToken: 'task-token-001', orderId: 'order-100' },
      });

      const callbackEvent = makeSqsEvent([{
        detailType: 'SIM_ORDER_FILLED',
        detail: {
          tenantId: 't-1',
          subject: {
            orderId: 'order-100',
            filledQuantity: 10,
            averageFillPrice: 243.50,
          },
        },
      }]);

      await callbackResolver(callbackEvent);

      // Verify SendTaskSuccess was called with correct output
      expect(mockSfnSend).toHaveBeenCalledTimes(1);
      const sfnResult = getSfnOutput(0);
      expect(sfnResult.taskToken).toBe('task-token-001');
      expect(sfnResult.output).toMatchObject({
        status: 'FILLED',
        failureClass: 'none',
        filledQty: 10,
        averageFillPrice: 243.50,
      });
    });
  });

  // ─── Scenario 2: Transient failure → retry → eventual fill ──────────────
  describe('Scenario 2: ORDER_SUBMITTED → transient rejection → retry → FILLED', () => {
    it('should handle transient failure then succeed on retry', async () => {
      // Step 1: First RouteOrder attempt
      const routeEvent: RouteOrderEvent = {
        order: baseOrder,
        executionMode: 'live',
        taskToken: 'task-token-002a',
      };

      await routeOrder(routeEvent);

      // Verify routed to Alpaca
      expect(mockDdbSend).toHaveBeenCalledTimes(1);
      const firstOrder = getPutItem(0);
      expect(firstOrder).toMatchObject({
        routedTo: 'alpaca',
        executionMode: 'live',
        fillTaskToken: 'task-token-002a',
      });
      expect(mockEbSend).toHaveBeenCalledTimes(1);
      expect(getEbEntry(0).DetailType).toBe('ALPACA_ORDER_REQUESTED');

      // Step 2: CallbackResolver receives transient rejection (503)
      jest.clearAllMocks();
      mockSfnSend.mockResolvedValue({});
      mockDdbSend.mockResolvedValueOnce({
        Item: { fillTaskToken: 'task-token-002a', orderId: 'order-100' },
      });

      const transientRejection = makeSqsEvent([{
        detailType: 'ALPACA_ORDER_REJECTED',
        detail: {
          tenantId: 't-1',
          subject: {
            orderId: 'order-100',
            rejectionReason: '503 service unavailable',
          },
        },
      }]);

      await callbackResolver(transientRejection);

      // Verify SF receives transient failure class — SF will retry
      expect(mockSfnSend).toHaveBeenCalledTimes(1);
      const transientResult = getSfnOutput(0);
      expect(transientResult.taskToken).toBe('task-token-002a');
      expect(transientResult.output).toMatchObject({
        status: 'REJECTED',
        failureClass: 'transient',
        failureReason: '503 service unavailable',
      });

      // Step 3: SF retries — second RouteOrder with new taskToken
      jest.clearAllMocks();
      mockDdbSend.mockResolvedValue({});
      mockEbSend.mockResolvedValue({});

      const retryEvent: RouteOrderEvent = {
        order: baseOrder,
        executionMode: 'live',
        taskToken: 'task-token-002b',
      };

      await routeOrder(retryEvent);

      expect(mockDdbSend).toHaveBeenCalledTimes(1);
      const retryOrder = getPutItem(0);
      expect(retryOrder.fillTaskToken).toBe('task-token-002b');

      // Step 4: CallbackResolver receives fill on retry
      jest.clearAllMocks();
      mockSfnSend.mockResolvedValue({});
      mockDdbSend.mockResolvedValueOnce({
        Item: { fillTaskToken: 'task-token-002b', orderId: 'order-100' },
      });

      const fillEvent = makeSqsEvent([{
        detailType: 'ALPACA_ORDER_FILLED',
        detail: {
          tenantId: 't-1',
          subject: {
            orderId: 'order-100',
            filledQuantity: 10,
            averageFillPrice: 244.00,
          },
        },
      }]);

      await callbackResolver(fillEvent);

      expect(mockSfnSend).toHaveBeenCalledTimes(1);
      const retryFillResult = getSfnOutput(0);
      expect(retryFillResult.taskToken).toBe('task-token-002b');
      expect(retryFillResult.output).toMatchObject({
        status: 'FILLED',
        failureClass: 'none',
        filledQty: 10,
        averageFillPrice: 244.00,
      });
    });
  });

  // ─── Scenario 3: Deterministic rejection → ORDER_REJECTED ───────────────
  describe('Scenario 3: ORDER_SUBMITTED → deterministic rejection → REJECTED', () => {
    it('should route order then resolve with deterministic rejection', async () => {
      // Step 1: RouteOrder
      const routeEvent: RouteOrderEvent = {
        order: { ...baseOrder, orderId: 'order-300' },
        executionMode: 'live',
        taskToken: 'task-token-003',
      };

      await routeOrder(routeEvent);

      // Verify BrokerOrder written
      const brokerOrder = getPutItem(0);
      expect(brokerOrder).toMatchObject({
        pk: 'BrokerOrder#t-1#order-300',
        state: 'AWAITING_FILL',
        routedTo: 'alpaca',
        fillTaskToken: 'task-token-003',
      });

      // Verify ALPACA_ORDER_REQUESTED emitted
      expect(getEbEntry(0).DetailType).toBe('ALPACA_ORDER_REQUESTED');

      // Step 2: CallbackResolver receives deterministic rejection
      jest.clearAllMocks();
      mockSfnSend.mockResolvedValue({});
      mockDdbSend.mockResolvedValueOnce({
        Item: { fillTaskToken: 'task-token-003', orderId: 'order-300' },
      });

      const rejectionEvent = makeSqsEvent([{
        detailType: 'ALPACA_ORDER_REJECTED',
        detail: {
          tenantId: 't-1',
          subject: {
            orderId: 'order-300',
            rejectionReason: 'insufficient buying power',
          },
        },
      }]);

      await callbackResolver(rejectionEvent);

      // Verify SF receives deterministic failure — SF will NOT retry
      expect(mockSfnSend).toHaveBeenCalledTimes(1);
      const sfnResult = getSfnOutput(0);
      expect(sfnResult.taskToken).toBe('task-token-003');
      expect(sfnResult.output).toMatchObject({
        status: 'REJECTED',
        failureClass: 'deterministic',
        failureReason: 'insufficient buying power',
      });
    });
  });

  // ─── Scenario 4: Timeout → circuit breaker → ORDER_ESCALATED ────────────
  describe('Scenario 4: ORDER_SUBMITTED → timeout → no taskToken (escalated)', () => {
    it('should route order, then callback finds no taskToken after SF timeout', async () => {
      // Step 1: RouteOrder
      const routeEvent: RouteOrderEvent = {
        order: { ...baseOrder, orderId: 'order-400' },
        executionMode: 'live',
        taskToken: 'task-token-004',
      };

      await routeOrder(routeEvent);

      // Verify BrokerOrder was written with fillTaskToken
      const brokerOrder = getPutItem(0);
      expect(brokerOrder).toMatchObject({
        pk: 'BrokerOrder#t-1#order-400',
        fillTaskToken: 'task-token-004',
        state: 'AWAITING_FILL',
      });
      expect(getEbEntry(0).DetailType).toBe('ALPACA_ORDER_REQUESTED');

      // Step 2: SF timeout fires — the SF marks order as ESCALATED and clears
      // the taskToken. Now a late adapter callback arrives but finds no taskToken.
      jest.clearAllMocks();
      mockSfnSend.mockResolvedValue({});

      // getOrder returns null Item — taskToken was cleared by SF timeout handler
      mockDdbSend.mockResolvedValueOnce({ Item: null });

      const lateCallback = makeSqsEvent([{
        detailType: 'ALPACA_ORDER_FILLED',
        detail: {
          tenantId: 't-1',
          subject: {
            orderId: 'order-400',
            filledQuantity: 10,
            averageFillPrice: 245.00,
          },
        },
      }]);

      await callbackResolver(lateCallback);

      // Verify SFN was NOT called — the late callback is silently dropped
      expect(mockSfnSend).not.toHaveBeenCalled();
    });

    it('should not call SFN when DDB returns order without fillTaskToken', async () => {
      // Simulates the case where the order exists but fillTaskToken was
      // explicitly cleared after the SF timeout transition
      mockDdbSend.mockResolvedValueOnce({
        Item: { orderId: 'order-400', state: 'ESCALATED' }, // no fillTaskToken
      });

      const lateCallback = makeSqsEvent([{
        detailType: 'ALPACA_ORDER_REJECTED',
        detail: {
          tenantId: 't-1',
          subject: {
            orderId: 'order-400',
            rejectionReason: 'connection timeout',
          },
        },
      }]);

      await callbackResolver(lateCallback);

      // No taskToken means callback resolver skips SFN call
      expect(mockSfnSend).not.toHaveBeenCalled();
    });
  });
});
