import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  EventBusTrap,
  type BusEventPayload,
} from '@nestfolio/integration-testing';

describe('investor-adpt: Execution → Investor forwarding', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createTestContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);

    // Trap on InvestorBus — event should arrive here after forwarding
    await trap.deploy({
      bus: 'investor',
      detailType: 'ORDER_REJECTED',
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should forward ORDER_REJECTED from ExecutionBus to InvestorBus', async () => {
    await eb.putEvent({
      bus: 'execution',
      targetService: 'investor-adpt',
      detailType: 'ORDER_REJECTED',
      detail: {
        orderId: `integ-order-${Date.now()}`,
        reason: 'SAFETY_CHECK_FAILED',
      },
    });

    const event = await trap.waitForEvent<BusEventPayload>();
    expect(event.detailType).toBe('ORDER_REJECTED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);
});
