import {
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  EventBusTrap,
  type BusEventPayload,
} from '@nestfolio/integration-testing';

describe('investor-adpt: Ledger → Investor forwarding', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let driftTrap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    driftTrap = new EventBusTrap(ctx);

    // Trap on InvestorBus — event should arrive here after forwarding
    await trap.deploy({
      bus: 'investor',
      detailType: 'BALANCE_UPDATED',
    });
    await driftTrap.deploy({
      bus: 'investor',
      detailType: 'PORTFOLIO_DRIFT_DETECTED',
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

  it('should forward PORTFOLIO_DRIFT_DETECTED from LedgerBus to InvestorBus', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'investor-adpt',
      detailType: 'PORTFOLIO_DRIFT_DETECTED',
      detail: {
        portfolioId: `integ-portfolio-${Date.now()}`,
        driftPercent: 5.2,
      },
    });

    const event = await driftTrap.waitForEvent<BusEventPayload>();
    expect(event.detailType).toBe('PORTFOLIO_DRIFT_DETECTED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);
});
