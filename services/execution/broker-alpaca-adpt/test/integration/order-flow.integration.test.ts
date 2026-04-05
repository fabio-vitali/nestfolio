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

describe('broker-alpaca-adpt: order flow', () => {
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

    // Single trap captures all outbound event types
    await trap.deploy({
      bus: 'execution',
      detailType: [
        'ALPACA_ORDER_PLACED', 'ALPACA_ORDER_FILLED', 'ALPACA_ORDER_REJECTED',
      ],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should place order, trigger polling SF, and fill', async () => {
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

    // Assert: SF polls mock, writes FILLED, CDC emits ALPACA_ORDER_FILLED
    const filledEvent = await trap.waitForEvent({
      detailType: 'ALPACA_ORDER_FILLED',
      timeoutMs: 90_000,
    });
    expect(filledEvent.detail.subject.nestfolioOrderId).toBe(orderId);
  }, 120_000);

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
});
