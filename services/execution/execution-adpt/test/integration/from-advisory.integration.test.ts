import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  type BusEventPayload,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('execution-adpt: Advisory → Execution forwarding', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);

    await trap.deploy({
      bus: 'execution',
      detailType: 'DECISION_APPROVED',
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should forward DECISION_APPROVED from AdvisoryBus to ExecutionBus', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'execution-adpt',
      detailType: 'DECISION_APPROVED',
      detail: {
        decisionId: `integ-decision-${Date.now()}`,
        portfolioId: 'test-portfolio-001',
        approvedAt: new Date().toISOString(),
      },
    });

    const event = await trap.waitForEvent<BusEventPayload>();
    expect(event.detailType).toBe('DECISION_APPROVED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);
});
