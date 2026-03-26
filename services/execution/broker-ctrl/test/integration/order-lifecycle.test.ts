/**
 * Integration tests: broker-ctrl handler chain.
 *
 * These tests call the actual handler functions to verify the end-to-end
 * handler chain. AWS SDK clients (DDB, EventBridge, SFN) are mocked at the
 * module level; createIngestionHandler/materializeToTable are patched to inject
 * the mocked DDB client (jest.requireActual bypasses AWS SDK mocks for
 * transitive dependencies loaded by the event-processor library).
 *
 * Order Lifecycle Scenarios:
 * 1. Happy path: ORDER_SUBMITTED → RouteOrder → SIM_ORDER_FILLED callback → FILLED
 * 2. Transient failure: RouteOrder → transient rejection → retry → eventual fill
 * 3. Deterministic rejection: RouteOrder → deterministic rejection → REJECTED
 * 4. Timeout / escalation: RouteOrder → no callback → taskToken already cleared
 *
 * Mode Listener: EXECUTION_MODE_CHANGED → ExecutionMode record in DDB
 * Deposit/Withdrawal Router: DEPOSIT_INITIATED / WITHDRAWAL_REQUESTED → routed by mode
 * Deposit/Withdrawal Normalizer: adapter results → NormalizedEvent records in DDB
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

jest.mock('@nestfolio/event-processor', () => {
  const actual = jest.requireActual('@nestfolio/event-processor');

  // Override createIngestionHandler to inject the mocked DDB client
  const originalCreateIngestionHandler = actual.createIngestionHandler;
  const patchedCreateIngestionHandler = (config: Record<string, unknown>) =>
    originalCreateIngestionHandler({
      ...config,
      table: { name: process.env.TABLE_NAME ?? 'broker-ctrl-table', client: { send: mockDdbSend } },
    });

  // Override materializeToTable to use the patched createIngestionHandler
  const patchedMaterializeToTable = (config: Record<string, unknown>) =>
    patchedCreateIngestionHandler({
      ...config,
      table: config.table ?? process.env.TABLE_NAME,
      bus: config.bus ?? process.env.BUS_NAME,
    });

  return {
    ...actual,
    createIngestionHandler: patchedCreateIngestionHandler,
    materializeToTable: patchedMaterializeToTable,
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
  };
});

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { handler as routeOrder, type RouteOrderEvent } from '../../src/handlers/route-order';
import { handler as callbackResolver } from '../../src/handlers/callback-resolver';
import { handler as modeListener } from '../../src/handlers/mode-listener';
import { handler as depositWithdrawalRouter } from '../../src/handlers/deposit-withdrawal-router';
import { handler as depositWithdrawalNormalizer } from '../../src/handlers/deposit-withdrawal-normalizer';
import { fakeSqsRecord } from '@nestfolio/event-processor';
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

/**
 * Find a DDB PutCommand call that wrote an item with the given __typename.
 * Works with both mocked PutCommand (_type='Put') and real PutCommand (constructor.name='PutCommand').
 */
function findPutItemByTypename(typename: string): Record<string, unknown> | undefined {
  for (const call of mockDdbSend.mock.calls) {
    const cmd = call[0];
    const item = cmd?.input?.Item;
    if (item && item.__typename === typename) return item;
  }
  return undefined;
}

/** Find the first DDB PutCommand call that wrote an Item (any command format). */
function findFirstPutItem(): Record<string, unknown> | undefined {
  for (const call of mockDdbSend.mock.calls) {
    const cmd = call[0];
    const item = cmd?.input?.Item;
    if (item) return item;
  }
  return undefined;
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

// ── Mode Listener Integration ─────────────────────────────────────────────
describe('Mode Listener Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDdbSend.mockResolvedValue({});
  });

  it('should materialize ExecutionMode record on EXECUTION_MODE_CHANGED (live)', async () => {
    const event: SQSEvent = {
      Records: [
        fakeSqsRecord('EXECUTION_MODE_CHANGED', { mode: 'live' }, { tenantId: 't-1' }),
      ],
    };

    const result = await modeListener(event);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockDdbSend).toHaveBeenCalled();
    const item = findPutItemByTypename('ExecutionMode');
    expect(item).toBeDefined();
    expect(item).toMatchObject({
      __typename: 'ExecutionMode',
      tenantId: 't-1',
      mode: 'live',
      pk: 'ExecutionMode#t-1',
      sk: 'ExecutionMode',
    });
  });

  it('should materialize ExecutionMode record on EXECUTION_MODE_CHANGED (simulation)', async () => {
    const event: SQSEvent = {
      Records: [
        fakeSqsRecord('EXECUTION_MODE_CHANGED', { mode: 'simulation' }, { tenantId: 't-2' }),
      ],
    };

    const result = await modeListener(event);

    expect(result.batchItemFailures).toHaveLength(0);
    const item = findPutItemByTypename('ExecutionMode');
    expect(item).toBeDefined();
    expect(item).toMatchObject({
      __typename: 'ExecutionMode',
      tenantId: 't-2',
      mode: 'simulation',
      pk: 'ExecutionMode#t-2',
      sk: 'ExecutionMode',
    });
  });
});

// ── Deposit/Withdrawal Router Integration ─────────────────────────────────
describe('Deposit/Withdrawal Router Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDdbSend.mockResolvedValue({});
    mockEbSend.mockResolvedValue({});
  });

  describe('DEPOSIT_INITIATED routing', () => {
    it('should route deposit to SIM_DEPOSIT_INITIATED when mode=simulation', async () => {
      // ExecutionModeRepository.getMode reads from DDB — return simulation mode
      mockDdbSend.mockResolvedValueOnce({ Item: { mode: 'simulation' } });

      const event: SQSEvent = {
        Records: [
          fakeSqsRecord('DEPOSIT_INITIATED', { amount: 1000, currency: 'USD' }, { tenantId: 't-1' }),
        ],
      };

      const result = await depositWithdrawalRouter(event);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockEbSend).toHaveBeenCalledTimes(1);
      const ebCall = mockEbSend.mock.calls[0][0];
      expect(ebCall.input.Entries[0]).toMatchObject({
        EventBusName: 'execution-bus',
        Source: 'broker-ctrl',
        DetailType: 'SIM_DEPOSIT_INITIATED',
      });
      const detail = JSON.parse(ebCall.input.Entries[0].Detail);
      expect(detail.tenantId).toBe('t-1');
      expect(detail.subject.direction).toBe('INCOMING');
      expect(detail.subject.amount).toBe(1000);
    });

    it('should route deposit to ALPACA_TRANSFER_REQUESTED when mode=live', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: { mode: 'live' } });

      const event: SQSEvent = {
        Records: [
          fakeSqsRecord('DEPOSIT_INITIATED', { amount: 5000, currency: 'USD' }, { tenantId: 't-2' }),
        ],
      };

      const result = await depositWithdrawalRouter(event);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockEbSend).toHaveBeenCalledTimes(1);
      const ebCall = mockEbSend.mock.calls[0][0];
      expect(ebCall.input.Entries[0]).toMatchObject({
        EventBusName: 'execution-bus',
        Source: 'broker-ctrl',
        DetailType: 'ALPACA_TRANSFER_REQUESTED',
      });
      const detail = JSON.parse(ebCall.input.Entries[0].Detail);
      expect(detail.tenantId).toBe('t-2');
      expect(detail.subject.direction).toBe('INCOMING');
    });
  });

  describe('WITHDRAWAL_REQUESTED routing', () => {
    it('should route withdrawal to SIM_WITHDRAWAL_REQUESTED when mode=simulation', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: { mode: 'simulation' } });

      const event: SQSEvent = {
        Records: [
          fakeSqsRecord('WITHDRAWAL_REQUESTED', { amount: 500, currency: 'USD' }, { tenantId: 't-3' }),
        ],
      };

      const result = await depositWithdrawalRouter(event);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockEbSend).toHaveBeenCalledTimes(1);
      const ebCall = mockEbSend.mock.calls[0][0];
      expect(ebCall.input.Entries[0]).toMatchObject({
        EventBusName: 'execution-bus',
        Source: 'broker-ctrl',
        DetailType: 'SIM_WITHDRAWAL_REQUESTED',
      });
      const detail = JSON.parse(ebCall.input.Entries[0].Detail);
      expect(detail.tenantId).toBe('t-3');
      expect(detail.subject.direction).toBe('OUTGOING');
    });

    it('should route withdrawal to ALPACA_TRANSFER_REQUESTED when mode=live', async () => {
      mockDdbSend.mockResolvedValueOnce({ Item: { mode: 'live' } });

      const event: SQSEvent = {
        Records: [
          fakeSqsRecord('WITHDRAWAL_REQUESTED', { amount: 2000, currency: 'USD' }, { tenantId: 't-4' }),
        ],
      };

      const result = await depositWithdrawalRouter(event);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockEbSend).toHaveBeenCalledTimes(1);
      const ebCall = mockEbSend.mock.calls[0][0];
      expect(ebCall.input.Entries[0]).toMatchObject({
        EventBusName: 'execution-bus',
        Source: 'broker-ctrl',
        DetailType: 'ALPACA_TRANSFER_REQUESTED',
      });
      const detail = JSON.parse(ebCall.input.Entries[0].Detail);
      expect(detail.tenantId).toBe('t-4');
      expect(detail.subject.direction).toBe('OUTGOING');
    });
  });

  describe('default mode fallback', () => {
    it('should default to simulation when no ExecutionMode record exists', async () => {
      // getMode returns undefined Item — defaults to 'simulation'
      mockDdbSend.mockResolvedValueOnce({ Item: undefined });

      const event: SQSEvent = {
        Records: [
          fakeSqsRecord('DEPOSIT_INITIATED', { amount: 100, currency: 'USD' }, { tenantId: 't-new' }),
        ],
      };

      const result = await depositWithdrawalRouter(event);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockEbSend).toHaveBeenCalledTimes(1);
      const ebCall = mockEbSend.mock.calls[0][0];
      expect(ebCall.input.Entries[0].DetailType).toBe('SIM_DEPOSIT_INITIATED');
    });
  });
});

// ── Deposit/Withdrawal Normalizer Integration ─────────────────────────────
describe('Deposit/Withdrawal Normalizer Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDdbSend.mockResolvedValue({});
  });

  it('should normalize SIM_DEPOSIT_COMPLETED to NormalizedEvent with sk=DEPOSIT_DETECTED', async () => {
    const event: SQSEvent = {
      Records: [
        fakeSqsRecord('SIM_DEPOSIT_COMPLETED', {
          depositId: 'dep-1',
          amountCents: 10000,
          currency: 'USD',
        }, { tenantId: 't-1' }),
      ],
    };

    const result = await depositWithdrawalNormalizer(event);

    expect(result.batchItemFailures).toHaveLength(0);
    const item = findFirstPutItem();
    expect(item).toBeDefined();
    expect(item).toMatchObject({
      __typename: 'NormalizedEvent',
      tenantId: 't-1',
      amount: 10000,
      currency: 'USD',
      executionMode: 'simulation',
      pk: 'NormalizedEvent#t-1#dep-1',
      sk: 'DEPOSIT_DETECTED',
    });
  });

  it('should normalize SIM_WITHDRAWAL_COMPLETED to NormalizedEvent with sk=WITHDRAWAL_COMPLETED', async () => {
    const event: SQSEvent = {
      Records: [
        fakeSqsRecord('SIM_WITHDRAWAL_COMPLETED', {
          withdrawalId: 'wdl-1',
          amount: 20000,
          currency: 'USD',
        }, { tenantId: 't-1' }),
      ],
    };

    const result = await depositWithdrawalNormalizer(event);

    expect(result.batchItemFailures).toHaveLength(0);
    const item = findFirstPutItem();
    expect(item).toBeDefined();
    expect(item).toMatchObject({
      __typename: 'NormalizedEvent',
      tenantId: 't-1',
      amount: 20000,
      currency: 'USD',
      executionMode: 'simulation',
      pk: 'NormalizedEvent#t-1#wdl-1',
      sk: 'WITHDRAWAL_COMPLETED',
    });
  });

  it('should normalize ALPACA_TRANSFER_COMPLETED INCOMING to sk=DEPOSIT_DETECTED', async () => {
    const event: SQSEvent = {
      Records: [
        fakeSqsRecord('ALPACA_TRANSFER_COMPLETED', {
          transferId: 'xfr-1',
          amount: 50000,
          direction: 'INCOMING',
        }, { tenantId: 't-2' }),
      ],
    };

    const result = await depositWithdrawalNormalizer(event);

    expect(result.batchItemFailures).toHaveLength(0);
    const item = findFirstPutItem();
    expect(item).toBeDefined();
    expect(item).toMatchObject({
      __typename: 'NormalizedEvent',
      tenantId: 't-2',
      amount: 50000,
      executionMode: 'live',
      pk: 'NormalizedEvent#t-2#xfr-1',
      sk: 'DEPOSIT_DETECTED',
    });
  });

  it('should normalize ALPACA_TRANSFER_COMPLETED OUTGOING to sk=WITHDRAWAL_COMPLETED', async () => {
    const event: SQSEvent = {
      Records: [
        fakeSqsRecord('ALPACA_TRANSFER_COMPLETED', {
          transferId: 'xfr-2',
          amount: 30000,
          direction: 'OUTGOING',
        }, { tenantId: 't-2' }),
      ],
    };

    const result = await depositWithdrawalNormalizer(event);

    expect(result.batchItemFailures).toHaveLength(0);
    const item = findFirstPutItem();
    expect(item).toBeDefined();
    expect(item).toMatchObject({
      __typename: 'NormalizedEvent',
      tenantId: 't-2',
      amount: 30000,
      executionMode: 'live',
      pk: 'NormalizedEvent#t-2#xfr-2',
      sk: 'WITHDRAWAL_COMPLETED',
    });
  });

  it('should normalize ALPACA_TRANSFER_FAILED to sk=TRANSFER_FAILED with failureReason', async () => {
    const event: SQSEvent = {
      Records: [
        fakeSqsRecord('ALPACA_TRANSFER_FAILED', {
          transferId: 'xfr-fail-1',
          amount: 15000,
          failureReason: 'Insufficient funds',
        }, { tenantId: 't-3' }),
      ],
    };

    const result = await depositWithdrawalNormalizer(event);

    expect(result.batchItemFailures).toHaveLength(0);
    const item = findFirstPutItem();
    expect(item).toBeDefined();
    expect(item).toMatchObject({
      __typename: 'NormalizedEvent',
      tenantId: 't-3',
      amount: 15000,
      executionMode: 'live',
      failureReason: 'Insufficient funds',
      pk: 'NormalizedEvent#t-3#xfr-fail-1',
      sk: 'TRANSFER_FAILED',
    });
  });

  it('should default failureReason on ALPACA_TRANSFER_FAILED when missing', async () => {
    const event: SQSEvent = {
      Records: [
        fakeSqsRecord('ALPACA_TRANSFER_FAILED', {
          transferId: 'xfr-fail-2',
          amount: 10000,
        }, { tenantId: 't-3' }),
      ],
    };

    const result = await depositWithdrawalNormalizer(event);

    expect(result.batchItemFailures).toHaveLength(0);
    const item = findFirstPutItem();
    expect(item).toBeDefined();
    expect(item!.failureReason).toBe('Transfer failed');
  });
});
