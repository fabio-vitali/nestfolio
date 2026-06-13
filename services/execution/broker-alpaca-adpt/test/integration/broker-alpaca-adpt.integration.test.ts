import { readFileSync } from 'fs';
import { join } from 'path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import {
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
  StateResetFixture,
  type BusEventPayload,
} from '@nestfolio/integration-testing';

describe('broker-alpaca-adpt', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();
    // Clear stale circuit breaker state from interrupted runs
    const stateReset = new StateResetFixture(ctx);
    await stateReset.reset([
      { table: 'broker-alpaca-adpt', pk: 'CircuitBreaker#alpaca' },
    ]);

    // Deploy mock Alpaca Lambda
    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '..', 'mocks', 'mock-alpaca.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-alpaca',
      handlerAsset: readFileSync(zipPath),
    });

    // Override SSM to point to mock
    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
      testValue: mockUrl,
      restoreTo: 'https://paper-api.alpaca.markets',
    });

    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);

    // Single trap captures all outbound event types across all flows
    await trap.deploy({
      bus: 'execution',
      detailType: [
        'ALPACA_ORDER_PLACED',
        'ALPACA_ORDER_REJECTED',
        'ALPACA_TRANSFER_INITIATED',
        'ALPACA_ACCOUNT_SNAPSHOT',
        'BROKER_CIRCUIT_OPEN',
      ],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── Order Flow ──────────────────────────────────────────────────────

  it('should place order and emit ALPACA_ORDER_PLACED', async () => {
    const orderId = `integ-fill-${Date.now()}`;

    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-alpaca-adpt',
      detailType: 'ALPACA_ORDER_REQUESTED',
      detail: { orderId, symbol: 'AAPL', side: 'BUY', quantity: 5 },
    });

    // Assert: initial DDB write (PLACED)
    const item = await table.waitForItem({
      table: 'broker-alpaca-adpt',
      pk: `OrderMapping#${ctx.tenantId}#${orderId}`,
      sk: 'OrderMapping',
    });
    expect(item['status']).toBe('PLACED');
    expect(item['alpacaOrderId']).toBeTruthy();

    // Assert: CDC emits ALPACA_ORDER_PLACED
    const placedEvent = await trap.waitForEvent<BusEventPayload>({ detailType: 'ALPACA_ORDER_PLACED' });
    expect(placedEvent.detail.subject.nestfolioOrderId).toBe(orderId);
  }, 60_000);

  it('should reject order and emit ALPACA_ORDER_REJECTED', async () => {
    const orderId = `integ-reject-${Date.now()}`;

    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-alpaca-adpt',
      detailType: 'ALPACA_ORDER_REQUESTED',
      detail: { orderId, symbol: 'AAPL', side: 'BUY', quantity: 5 },
    });

    const item = await table.waitForItem({
      table: 'broker-alpaca-adpt',
      pk: `OrderMapping#${ctx.tenantId}#${orderId}`,
      sk: 'OrderMapping',
    });
    expect(item['status']).toBe('REJECTED');
    expect(item['rejectionReason']).toBeTruthy();

    const event = await trap.waitForEvent<BusEventPayload>({ detailType: 'ALPACA_ORDER_REJECTED' });
    expect(event.detail.subject.status).toBe('REJECTED');
  }, 60_000);

  // ── Transfer Flow ───────────────────────────────────────────────────

  it('should initiate transfer and emit ALPACA_TRANSFER_INITIATED', async () => {
    const transferId = `integ-transfer-ok-${Date.now()}`;

    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-alpaca-adpt',
      detailType: 'ALPACA_TRANSFER_REQUESTED',
      detail: {
        // AlpacaTransferRequestSchema: amountCents (NOT amount) + currency.
        transferId,
        amountCents: 1000000, // $10,000
        currency: 'USD',
        direction: 'INCOMING',
        relationshipId: 'rel-integ',
      },
    });

    const item = await table.waitForItem({
      table: 'broker-alpaca-adpt',
      pk: `TransferMapping#${ctx.tenantId}#${transferId}`,
      sk: 'TransferMapping',
    });
    expect(item['status']).toBe('INITIATED');

    const initiatedEvent = await trap.waitForEvent<BusEventPayload>({ detailType: 'ALPACA_TRANSFER_INITIATED' });
    expect(initiatedEvent.detail.subject.nestfolioTransferId).toBe(transferId);
  }, 60_000);

  it('should initiate transfer with typed AlpacaTransferRequest subject (amountCents→dollars conversion)', async () => {
    // Task 7, Step 1: typed AlpacaTransferRequest — the NEW producer-owned subject shape
    // (amountCents replaces the old `amount` field; handler divides by 100 before calling Alpaca).
    // The mock-alpaca Lambda (POST /v2/ach/transfers) always returns 200 + { id: 'mock-...' }
    // for any transfer, so we only need a non-scenario-triggering prefix. Unique-suffix the
    // id (matches the suite convention) so cross-run cleanup gaps can't collide.
    const transferId = `dep-int-1-${Date.now()}`;

    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-alpaca-adpt',
      detailType: 'ALPACA_TRANSFER_REQUESTED',
      detail: {
        transferId,
        amountCents: 5000,
        currency: 'USD',
        direction: 'INCOMING',
        relationshipId: '',
      },
    });

    // Assert: AlpacaTransferResult row written with the correct fields.
    // `amount` is stored as dollars (amountCents / 100 = 50) — proving the cents→dollars
    // conversion fired; `nestfolioTransferId` threads the original transferId end-to-end.
    const item = await table.waitForItem({
      table: 'broker-alpaca-adpt',
      pk: `TransferMapping#${ctx.tenantId}#${transferId}`,
      sk: 'TransferMapping',
    });
    expect(item['nestfolioTransferId']).toBe(transferId);
    expect(item['amount']).toBe(50); // amountCents 5000 → dollars 50
    expect(item['status']).toBe('INITIATED');
    // alpacaTransferId is set by the mock (non-empty string from mock-alpaca)
    expect(item['alpacaTransferId']).toBeTruthy();

    // Assert: CDC emits ALPACA_TRANSFER_INITIATED with the correct nestfolioTransferId.
    const initiatedEvent = await trap.waitForEvent<BusEventPayload>({
      detailType: 'ALPACA_TRANSFER_INITIATED',
      timeoutMs: 30_000,
    });
    expect(initiatedEvent.detail.subject.nestfolioTransferId).toBe(transferId);
    // amount on the CDC subject is also in dollars (the AlpacaTransferResult row fields)
    expect(initiatedEvent.detail.subject.amount).toBe(50);
  }, 60_000);

  // ── Account Check ──────────────────────────────────────────────────

  it('should create account snapshot and emit ALPACA_ACCOUNT_SNAPSHOT', async () => {
    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-alpaca-adpt',
      detailType: 'ALPACA_ACCOUNT_CHECK',
      detail: {},
    });

    const item = await table.waitForItem({
      table: 'broker-alpaca-adpt',
      pk: `AccountSnapshot#${ctx.tenantId}`,
    });
    expect(item['equity']).toBe('125000.00');
    expect(item['positions']).toHaveLength(1);

    const event = await trap.waitForEvent<BusEventPayload>({ detailType: 'ALPACA_ACCOUNT_SNAPSHOT' });
    expect(event.detail.subject.equity).toBe('125000.00');
  }, 60_000);

  // ── Circuit Breaker ─────────────────────────────────────────────────

  describe('Circuit Breaker', () => {
    const CB_PK = 'CircuitBreaker#alpaca';
    const CB_SK = 'CircuitBreaker';
    let ddb: DynamoDBDocumentClient;
    let cbTableName: string;

    beforeAll(async () => {
      ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: ctx.region }));
      cbTableName = await ctx.ssm.tableName('broker-alpaca-adpt');
    });

    async function putOpenBreaker(): Promise<void> {
      await ddb.send(
        new PutCommand({
          TableName: cbTableName,
          Item: {
            pk: CB_PK,
            sk: CB_SK,
            __typename: 'CircuitBreaker',
            state: 'OPEN',
            adapter: 'alpaca',
            openedAt: new Date().toISOString(),
            reason: 'Integration test',
          },
        }),
      );
    }

    async function deleteBreaker(): Promise<void> {
      try {
        await ddb.send(
          new DeleteCommand({
            TableName: cbTableName,
            Key: { pk: CB_PK, sk: CB_SK },
          }),
        );
      } catch { /* item may not exist */ }
    }

    afterEach(async () => {
      await deleteBreaker();
    });

    it('should reject order immediately when breaker is open', async () => {
      await putOpenBreaker();

      const orderId = `integ-cb-order-${Date.now()}`;

      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-alpaca-adpt',
        detailType: 'ALPACA_ORDER_REQUESTED',
        detail: { orderId, symbol: 'AAPL', side: 'BUY', quantity: 5 },
      });

      const item = await table.waitForItem({
        table: 'broker-alpaca-adpt',
        pk: `OrderMapping#${ctx.tenantId}#${orderId}`,
        sk: 'OrderMapping',
      });
      expect(item['status']).toBe('REJECTED');
      expect(item['rejectionReason']).toBe('BROKER_UNAVAILABLE');
    }, 60_000);

    it('should reject transfer immediately when breaker is open', async () => {
      await putOpenBreaker();

      const transferId = `integ-cb-transfer-${Date.now()}`;

      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-alpaca-adpt',
        detailType: 'ALPACA_TRANSFER_REQUESTED',
        detail: {
          // AlpacaTransferRequestSchema: amountCents (NOT amount) + currency.
          // The handler parseSubject's this BEFORE the breaker check, so even the
          // breaker-open path requires a schema-valid subject.
          transferId,
          amountCents: 1000000, // $10,000
          currency: 'USD',
          direction: 'INCOMING',
          relationshipId: 'rel-integ',
        },
      });

      const item = await table.waitForItem({
        table: 'broker-alpaca-adpt',
        pk: `TransferMapping#${ctx.tenantId}#${transferId}`,
        sk: 'TransferMapping',
      });
      expect(item['status']).toBe('FAILED');
      expect(item['failureReason']).toBe('BROKER_UNAVAILABLE');
    }, 60_000);

    it('should open circuit breaker on API failure and emit BROKER_CIRCUIT_OPEN via CDC', async () => {
      const orderId = `integ-broker-down-${Date.now()}`;

      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-alpaca-adpt',
        detailType: 'ALPACA_ORDER_REQUESTED',
        detail: { orderId, symbol: 'AAPL', side: 'BUY', quantity: 5 },
      });

      // Handler: submitOrder fails 3x (503) → healthCheck fails (503) → opens breaker
      // → writes CircuitBreaker item + NormalizedEvent → CDC emits BROKER_CIRCUIT_OPEN

      // 1. Verify CircuitBreaker record written
      const cbItem = await table.waitForItem({
        table: 'broker-alpaca-adpt',
        pk: CB_PK,
        sk: CB_SK,
        match: { state: 'OPEN' },
        timeoutMs: 90_000,
      });
      expect(cbItem['adapter']).toBe('alpaca');

      // 2. Verify order was rejected with BROKER_UNAVAILABLE
      const orderItem = await table.waitForItem({
        table: 'broker-alpaca-adpt',
        pk: `OrderMapping#${ctx.tenantId}#${orderId}`,
        sk: 'OrderMapping',
      });
      expect(orderItem['status']).toBe('REJECTED');
      expect(orderItem['rejectionReason']).toBe('BROKER_UNAVAILABLE');

      // 3. Verify CDC emitted BROKER_CIRCUIT_OPEN on ExecutionBus
      const event = await trap.waitForEvent<BusEventPayload>({ detailType: 'BROKER_CIRCUIT_OPEN' });
      expect(event.detail.subject.adapter).toBe('alpaca');
    }, 120_000);
  });
});
