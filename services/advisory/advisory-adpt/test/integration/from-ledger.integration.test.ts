import {
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  EventBusTrap,
  type BusEventPayload,
} from '@nestfolio/integration-testing';

describe('advisory-adpt: Ledger → Advisory forwarding', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);

    // Trap on AdvisoryBus — event should arrive here after forwarding
    await trap.deploy({
      bus: 'advisory',
      detailType: 'PORTFOLIO_UPDATED',
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should forward PORTFOLIO_UPDATED from LedgerBus to AdvisoryBus', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'advisory-adpt',
      detailType: 'PORTFOLIO_UPDATED',
      detail: {
        portfolioId: `integ-portfolio-${Date.now()}`,
        totalValue: 250000,
      },
    });

    const event = await trap.waitForEvent<BusEventPayload>();
    expect(event.detailType).toBe('PORTFOLIO_UPDATED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);
});
