import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  EventBusTrap,
  type BusEventPayload,
} from '@nestfolio/integration-testing';

describe('investor-adpt: Ledger → Investor forwarding', () => {
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
      detailType: 'BALANCE_UPDATED',
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should forward BALANCE_UPDATED from LedgerBus to InvestorBus', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'investor-adpt',
      detailType: 'BALANCE_UPDATED',
      detail: {
        portfolioId: `integ-portfolio-${Date.now()}`,
        cashBalanceCents: 500000,
      },
    });

    const event = await trap.waitForEvent<BusEventPayload>();
    expect(event.detailType).toBe('BALANCE_UPDATED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);
});
