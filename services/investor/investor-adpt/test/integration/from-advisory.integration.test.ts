import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  type BusEventPayload,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('investor-adpt: Advisory → Investor forwarding', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);

    // Trap on InvestorBus — event should arrive here after forwarding
    await trap.deploy({
      bus: 'investor',
      detailType: 'DECISION_PACKET_CREATED',
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should forward DECISION_PACKET_CREATED from AdvisoryBus to InvestorBus', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'investor-adpt',
      detailType: 'DECISION_PACKET_CREATED',
      detail: {
        decisionId: `integ-decision-${Date.now()}`,
        portfolioId: 'test-portfolio-001',
      },
    });

    const event = await trap.waitForEvent<BusEventPayload>();
    expect(event.detailType).toBe('DECISION_PACKET_CREATED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);
});
