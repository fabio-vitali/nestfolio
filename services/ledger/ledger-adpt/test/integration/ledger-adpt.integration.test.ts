import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  type BusEventPayload,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('ledger-adpt: Execution → Ledger forwarding', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);

    await trap.deploy({
      bus: 'ledger',
      detailType: 'ORDER_FILLED',
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should forward ORDER_FILLED from ExecutionBus to LedgerBus', async () => {
    await eb.putEvent({
      bus: 'execution',
      targetService: 'ledger-adpt',
      detailType: 'ORDER_FILLED',
      detail: {
        orderId: `integ-order-${Date.now()}`,
        symbol: 'AAPL',
        quantity: 10,
        fillPrice: 175.5,
      },
    });

    const event = await trap.waitForEvent<BusEventPayload>();
    expect(event.detailType).toBe('ORDER_FILLED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);
});
