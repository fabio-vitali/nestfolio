import { readFileSync } from 'fs';
import { join } from 'path';
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('broker-alpaca-adpt', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();

    // Deploy mock Alpaca Lambda
    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '../../../../..', 'libs/integration-testing/assets/mock-alpaca.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-alpaca',
      handlerAsset: readFileSync(zipPath),
    });

    // Override SSM to point to mock
    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
      testValue: mockUrl,
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
    const placedEvent = await trap.waitForEvent({ detailType: 'ALPACA_ORDER_PLACED' });
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

    const event = await trap.waitForEvent({ detailType: 'ALPACA_ORDER_REJECTED' });
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
        transferId,
        direction: 'INCOMING',
        amount: 10000,
        relationshipId: 'rel-integ',
      },
    });

    const item = await table.waitForItem({
      table: 'broker-alpaca-adpt',
      pk: `TransferMapping#${ctx.tenantId}#${transferId}`,
      sk: 'TransferMapping',
    });
    expect(item['status']).toBe('INITIATED');

    const initiatedEvent = await trap.waitForEvent({ detailType: 'ALPACA_TRANSFER_INITIATED' });
    expect(initiatedEvent.detail.subject.nestfolioTransferId).toBe(transferId);
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

    const event = await trap.waitForEvent({ detailType: 'ALPACA_ACCOUNT_SNAPSHOT' });
    expect(event.detail.subject.equity).toBe('125000.00');
  }, 60_000);
});
