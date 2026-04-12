import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  EventBusTrap,
} from '@nestfolio/integration-testing';

describe('reconciliation-ctrl: PORTFOLIO_UPDATED → RECONCILIATION_COMPLETED CDC', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createTestContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    await trap.deploy({ bus: 'ledger', detailType: 'RECONCILIATION_COMPLETED' });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should emit RECONCILIATION_COMPLETED on PORTFOLIO_UPDATED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'reconciliation-ctrl',
      detailType: 'PORTFOLIO_UPDATED',
      detail: {
        portfolioId: `portfolio-integ-${ctx.tenantId}`,
        positions: [
          { symbol: 'AAPL', quantity: 10 },
          { symbol: 'MSFT', quantity: 5 },
        ],
      },
    });

    const event = await trap.waitForEvent({ timeoutMs: 90_000 });

    expect(event.detailType).toBe('RECONCILIATION_COMPLETED');
  }, 120_000);
});
