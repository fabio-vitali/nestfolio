import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('advisory-adpt: Investor → Advisory forwarding', () => {
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
      detailType: 'GOAL_UPDATED',
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should forward GOAL_UPDATED from InvestorBus to AdvisoryBus', async () => {
    await eb.putEvent({
      bus: 'investor',
      targetService: 'advisory-adpt',
      detailType: 'GOAL_UPDATED',
      detail: {
        goalId: `integ-goal-${Date.now()}`,
        targetAmount: 100000,
      },
    });

    const event = await trap.waitForEvent();
    expect(event.detailType).toBe('GOAL_UPDATED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);
});
