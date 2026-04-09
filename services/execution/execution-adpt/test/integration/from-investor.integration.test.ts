import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  type BusEventPayload,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('execution-adpt: Investor → Execution forwarding', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);

    await trap.deploy({
      bus: 'execution',
      detailType: 'EXECUTION_MODE_CHANGED',
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should forward EXECUTION_MODE_CHANGED from InvestorBus to ExecutionBus', async () => {
    await eb.putEvent({
      bus: 'investor',
      targetService: 'execution-adpt',
      detailType: 'EXECUTION_MODE_CHANGED',
      detail: {
        investorId: `integ-investor-${Date.now()}`,
        mode: 'LIVE',
        changedAt: new Date().toISOString(),
      },
    });

    const event = await trap.waitForEvent<BusEventPayload>();
    expect(event.detailType).toBe('EXECUTION_MODE_CHANGED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);
});
