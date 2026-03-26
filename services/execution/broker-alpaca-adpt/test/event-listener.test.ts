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
    getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  };
});

// Mock AlpacaClient
const mockSubmitOrder = jest.fn();
const mockCancelOrder = jest.fn();
const mockInitiateTransfer = jest.fn();
const mockGetAccount = jest.fn();
const mockGetPositions = jest.fn();

jest.mock('../src/clients/alpaca.client', () => ({
  AlpacaClient: jest.fn().mockImplementation(() => ({
    submitOrder: mockSubmitOrder,
    cancelOrder: mockCancelOrder,
    initiateTransfer: mockInitiateTransfer,
    getAccount: mockGetAccount,
    getPositions: mockGetPositions,
  })),
}));

process.env.TABLE_NAME = 'test-table';

import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { AlpacaAdptEventTypes } from '../src/domain/events';
import { AlpacaOrdersService } from '../src/services/alpaca-orders.service';
import { OrderMappingRepository } from '../src/repositories/order-mapping.repository';
import { PollingStateRepository } from '../src/repositories/polling-state.repository';
import { AlpacaClient } from '../src/clients/alpaca.client';
import { record } from '@nestfolio/event-processor';
import type { EventPayload, EventContext } from '@nestfolio/event-processor';

// Build the same handlers as the event-listener module, but with injectable mocks
function createHandlers(deps: {
  client: AlpacaClient;
  orderRepo: OrderMappingRepository;
  pollingRepo: PollingStateRepository;
  ordersService: AlpacaOrdersService;
}) {
  const { client, orderRepo, ordersService } = deps;

  return {
    [AlpacaAdptEventTypes.ALPACA_ORDER_REQUESTED]: async (payload: EventPayload, ctx: EventContext) => {
      const s = payload.subject;
      const result = await ordersService.submitOrder(
        ctx.tenantId, s.orderId as string, s.symbol as string, s.side as string, s.quantity as number,
      );
      return record('AlpacaOrderResult', result, { pk: result.pk, sk: result.sk });
    },
    [AlpacaAdptEventTypes.ALPACA_ORDER_CANCEL_REQUESTED]: async (payload: EventPayload, ctx: EventContext) => {
      const s = payload.subject;
      const mapping = await orderRepo.getByNestfolioOrderId(ctx.tenantId, s.orderId as string);
      if (!mapping) {
        return record('AlpacaOrderResult', {
          __typename: 'AlpacaOrderResult', tenantId: ctx.tenantId, nestfolioOrderId: s.orderId,
          status: 'CANCEL_FAILED', rejectionReason: 'Order not found',
        }, { pk: `OrderMapping#${ctx.tenantId}#${s.orderId}`, sk: 'CancelResult' });
      }
      const result = await client.cancelOrder(mapping.alpacaOrderId as string);
      const status = result.status < 300 ? 'CANCELLED' : 'CANCEL_FAILED';
      return record('AlpacaOrderResult', {
        __typename: 'AlpacaOrderResult', tenantId: ctx.tenantId, nestfolioOrderId: s.orderId,
        alpacaOrderId: mapping.alpacaOrderId, status,
        rejectionReason: status === 'CANCEL_FAILED' ? JSON.stringify(result.data) : undefined,
      }, { pk: `OrderMapping#${ctx.tenantId}#${s.orderId}`, sk: 'CancelResult' });
    },
    [AlpacaAdptEventTypes.ALPACA_TRANSFER_REQUESTED]: async (payload: EventPayload, ctx: EventContext) => {
      const s = payload.subject;
      const result = await client.initiateTransfer({
        transfer_type: 'ach',
        direction: s.direction as 'INCOMING' | 'OUTGOING',
        amount: String(s.amount),
        relationship_id: (s.relationshipId as string) ?? '',
      });
      const alpacaTransferId = result.status < 300 ? (result.data as any).id : '';
      const status = result.status < 300 ? 'INITIATED' : 'FAILED';
      return record('AlpacaTransferResult', {
        __typename: 'AlpacaTransferResult', tenantId: ctx.tenantId,
        nestfolioTransferId: s.transferId ?? ctx.eventId,
        alpacaTransferId, direction: s.direction, amount: s.amount, status,
        failureReason: status === 'FAILED' ? JSON.stringify(result.data) : undefined,
      }, { pk: `TransferMapping#${ctx.tenantId}#${(s.transferId ?? ctx.eventId) as string}`, sk: 'TransferMapping' });
    },
    [AlpacaAdptEventTypes.ALPACA_ACCOUNT_CHECK]: async (payload: EventPayload, ctx: EventContext) => {
      const [account, positions] = await Promise.all([client.getAccount(), client.getPositions()]);
      return record('AlpacaAccountSnapshot', {
        __typename: 'AlpacaAccountSnapshot', tenantId: ctx.tenantId,
        equity: (account.data as any).equity, buyingPower: (account.data as any).buying_power,
        positions: ((positions.data as any[]) ?? []).map((p: any) => ({
          symbol: p.symbol, qty: Number(p.qty), marketValue: Number(p.market_value),
        })),
      }, { pk: `AccountSnapshot#${ctx.tenantId}`, sk: `Snapshot#${ctx.timestamp}` });
    },
  };
}

describe('broker-alpaca-adpt event-listener handler', () => {
  const mockClientInstance = {
    submitOrder: mockSubmitOrder,
    cancelOrder: mockCancelOrder,
    initiateTransfer: mockInitiateTransfer,
    getAccount: mockGetAccount,
    getPositions: mockGetPositions,
  } as unknown as AlpacaClient;

  const orderRepo = new OrderMappingRepository('test-table');
  const pollingRepo = new PollingStateRepository('test-table');
  const ordersService = new AlpacaOrdersService(mockClientInstance, orderRepo, pollingRepo);

  const harness = createTestHarness({
    serviceName: 'broker-alpaca-adpt',
    handlers: createHandlers({ client: mockClientInstance, orderRepo, pollingRepo, ordersService }),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  describe('ALPACA_ORDER_REQUESTED', () => {
    it('returns AlpacaOrderResult with PLACED status on success', async () => {
      mockSubmitOrder.mockResolvedValueOnce({ status: 200, data: { id: 'alpaca-order-abc' } });

      const result = await harness.process([
        fakeSqsRecord(AlpacaAdptEventTypes.ALPACA_ORDER_REQUESTED, {
          orderId: 'nf-order-1',
          symbol: 'AAPL',
          side: 'BUY',
          quantity: 5,
        }, { tenantId: 'tenant-1', eventId: 'evt-1' }),
      ]);

      expect(result.batchItemFailures).toHaveLength(0);
      const intent = result.intents.find((i) => i._tag === 'record');
      expect(intent).toMatchObject({
        _tag: 'record',
        typename: 'AlpacaOrderResult',
        fields: expect.objectContaining({
          __typename: 'AlpacaOrderResult',
          tenantId: 'tenant-1',
          nestfolioOrderId: 'nf-order-1',
          alpacaOrderId: 'alpaca-order-abc',
          status: 'PLACED',
          symbol: 'AAPL',
        }),
        overrides: {
          pk: 'OrderMapping#tenant-1#nf-order-1',
          sk: 'OrderMapping',
        },
      });
    });

    it('returns AlpacaOrderResult with REJECTED status on Alpaca rejection', async () => {
      mockSubmitOrder.mockResolvedValueOnce({ status: 422, data: { message: 'insufficient funds' } });

      const result = await harness.process([
        fakeSqsRecord(AlpacaAdptEventTypes.ALPACA_ORDER_REQUESTED, {
          orderId: 'nf-order-2',
          symbol: 'TSLA',
          side: 'BUY',
          quantity: 10,
        }, { tenantId: 'tenant-1', eventId: 'evt-2' }),
      ]);

      expect(result.batchItemFailures).toHaveLength(0);
      const intent = result.intents.find((i) => i._tag === 'record');
      expect(intent).toMatchObject({
        _tag: 'record',
        typename: 'AlpacaOrderResult',
        fields: expect.objectContaining({
          status: 'REJECTED',
          alpacaOrderId: '',
        }),
      });
    });
  });

  describe('ALPACA_ORDER_CANCEL_REQUESTED', () => {
    it('returns CANCELLED when mapping found and cancel succeeds', async () => {
      // getByNestfolioOrderId: GetCommand returns the mapping
      mockSend.mockResolvedValueOnce({
        Item: { alpacaOrderId: 'alpaca-order-abc', nestfolioOrderId: 'nf-order-1' },
      });
      mockCancelOrder.mockResolvedValueOnce({ status: 204, data: null });

      const result = await harness.process([
        fakeSqsRecord(AlpacaAdptEventTypes.ALPACA_ORDER_CANCEL_REQUESTED, {
          orderId: 'nf-order-1',
        }, { tenantId: 'tenant-1', eventId: 'evt-cancel-1' }),
      ]);

      expect(result.batchItemFailures).toHaveLength(0);
      const intent = result.intents.find((i) => i._tag === 'record');
      expect(intent).toMatchObject({
        _tag: 'record',
        typename: 'AlpacaOrderResult',
        fields: expect.objectContaining({ status: 'CANCELLED' }),
      });
    });

    it('returns CANCEL_FAILED when mapping not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await harness.process([
        fakeSqsRecord(AlpacaAdptEventTypes.ALPACA_ORDER_CANCEL_REQUESTED, {
          orderId: 'unknown-order',
        }, { tenantId: 'tenant-1', eventId: 'evt-cancel-2' }),
      ]);

      expect(result.batchItemFailures).toHaveLength(0);
      const intent = result.intents.find((i) => i._tag === 'record');
      expect(intent).toMatchObject({
        _tag: 'record',
        typename: 'AlpacaOrderResult',
        fields: expect.objectContaining({
          status: 'CANCEL_FAILED',
          rejectionReason: 'Order not found',
        }),
      });
    });

    it('returns CANCEL_FAILED when Alpaca returns error', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { alpacaOrderId: 'alpaca-order-xyz', nestfolioOrderId: 'nf-order-3' },
      });
      mockCancelOrder.mockResolvedValueOnce({ status: 422, data: { message: 'already filled' } });

      const result = await harness.process([
        fakeSqsRecord(AlpacaAdptEventTypes.ALPACA_ORDER_CANCEL_REQUESTED, {
          orderId: 'nf-order-3',
        }, { tenantId: 'tenant-1', eventId: 'evt-cancel-3' }),
      ]);

      expect(result.batchItemFailures).toHaveLength(0);
      const intent = result.intents.find((i) => i._tag === 'record');
      expect(intent).toMatchObject({
        _tag: 'record',
        typename: 'AlpacaOrderResult',
        fields: expect.objectContaining({ status: 'CANCEL_FAILED' }),
      });
    });
  });

  describe('ALPACA_TRANSFER_REQUESTED', () => {
    it('returns AlpacaTransferResult with INITIATED status on success', async () => {
      mockInitiateTransfer.mockResolvedValueOnce({ status: 200, data: { id: 'alpaca-transfer-abc' } });

      const result = await harness.process([
        fakeSqsRecord(AlpacaAdptEventTypes.ALPACA_TRANSFER_REQUESTED, {
          transferId: 'nf-transfer-1',
          direction: 'INCOMING',
          amount: 10000,
          relationshipId: 'rel-123',
        }, { tenantId: 'tenant-1', eventId: 'evt-transfer-1' }),
      ]);

      expect(result.batchItemFailures).toHaveLength(0);
      const intent = result.intents.find((i) => i._tag === 'record');
      expect(intent).toMatchObject({
        _tag: 'record',
        typename: 'AlpacaTransferResult',
        fields: expect.objectContaining({
          __typename: 'AlpacaTransferResult',
          tenantId: 'tenant-1',
          nestfolioTransferId: 'nf-transfer-1',
          alpacaTransferId: 'alpaca-transfer-abc',
          status: 'INITIATED',
          direction: 'INCOMING',
        }),
      });
    });

    it('returns AlpacaTransferResult with FAILED status on Alpaca error', async () => {
      mockInitiateTransfer.mockResolvedValueOnce({ status: 400, data: { message: 'invalid relationship' } });

      const result = await harness.process([
        fakeSqsRecord(AlpacaAdptEventTypes.ALPACA_TRANSFER_REQUESTED, {
          transferId: 'nf-transfer-2',
          direction: 'OUTGOING',
          amount: 500,
          relationshipId: 'rel-bad',
        }, { tenantId: 'tenant-1', eventId: 'evt-transfer-2' }),
      ]);

      expect(result.batchItemFailures).toHaveLength(0);
      const intent = result.intents.find((i) => i._tag === 'record');
      expect(intent).toMatchObject({
        _tag: 'record',
        typename: 'AlpacaTransferResult',
        fields: expect.objectContaining({ status: 'FAILED', alpacaTransferId: '' }),
      });
    });
  });

  describe('ALPACA_ACCOUNT_CHECK', () => {
    it('returns AlpacaAccountSnapshot with equity, buyingPower, and positions', async () => {
      mockGetAccount.mockResolvedValueOnce({
        status: 200,
        data: { equity: '125000.00', buying_power: '50000.00' },
      });
      mockGetPositions.mockResolvedValueOnce({
        status: 200,
        data: [
          { symbol: 'AAPL', qty: '10', market_value: '1750.00' },
          { symbol: 'TSLA', qty: '5', market_value: '900.00' },
        ],
      });

      const result = await harness.process([
        fakeSqsRecord(AlpacaAdptEventTypes.ALPACA_ACCOUNT_CHECK, {}, {
          tenantId: 'tenant-1',
          eventId: 'evt-check-1',
          timestamp: '2025-01-01T12:00:00.000Z',
        }),
      ]);

      expect(result.batchItemFailures).toHaveLength(0);
      const intent = result.intents.find((i) => i._tag === 'record');
      expect(intent).toMatchObject({
        _tag: 'record',
        typename: 'AlpacaAccountSnapshot',
        fields: expect.objectContaining({
          __typename: 'AlpacaAccountSnapshot',
          tenantId: 'tenant-1',
          equity: '125000.00',
          buyingPower: '50000.00',
          positions: expect.arrayContaining([
            expect.objectContaining({ symbol: 'AAPL', qty: 10, marketValue: 1750 }),
            expect.objectContaining({ symbol: 'TSLA', qty: 5, marketValue: 900 }),
          ]),
        }),
        overrides: expect.objectContaining({
          pk: 'AccountSnapshot#tenant-1',
        }),
      });
    });
  });
});
