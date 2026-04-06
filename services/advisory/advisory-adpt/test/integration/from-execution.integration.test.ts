import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('advisory-adpt: Execution → Advisory forwarding', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);

    // Trap on AdvisoryBus — event should arrive here after forwarding
    await trap.deploy({
      bus: 'advisory',
      detailType: 'ORDER_FILLED',
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should forward ORDER_FILLED from ExecutionBus to AdvisoryBus', async () => {
    await eb.putEvent({
      bus: 'execution',
      targetService: 'advisory-adpt',
      detailType: 'ORDER_FILLED',
      detail: {
        orderId: `integ-order-${Date.now()}`,
        filledQuantity: 10,
        filledPrice: 150.5,
      },
    });

    const event = await trap.waitForEvent();
    expect(event.detailType).toBe('ORDER_FILLED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);
});
