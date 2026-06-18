import {
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  EventBusTrap,
} from '@nestfolio/integration-testing';

describe('reconciliation-ctrl: PORTFOLIO_UPDATED → RECONCILIATION_COMPLETED CDC', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    await trap.deploy({ bus: 'ledger', detailType: 'RECONCILIATION_COMPLETED' });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should emit RECONCILIATION_COMPLETED on PORTFOLIO_UPDATED', async () => {
    // Cache-and-compare requires both sides. Send Settlement side first.
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'reconciliation-ctrl',
      detailType: 'ALPACA_ACCOUNT_SNAPSHOT',
      subject: {
        equity: '0',
        buyingPower: '0',
        positions: [
          { symbol: 'AAPL', qty: 10, marketValue: 0 },
          { symbol: 'MSFT', qty: 5, marketValue: 0 },
        ],
      },
    });

    // Small delay to let the Settlement snapshot get cached
    await new Promise(r => setTimeout(r, 10_000));

    // Now send the Intent side — triggers reconciliation
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'reconciliation-ctrl',
      detailType: 'PORTFOLIO_UPDATED',
      subject: {
        positions: {
          AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 0, totalCostBasis: 0, lastFillPrice: 0 },
          MSFT: { symbol: 'MSFT', quantity: 5,  averageCostBasis: 0, totalCostBasis: 0, lastFillPrice: 0 },
        },
        snapshot: { positions: {}, cashBalanceCents: 0, lastEventSequence: 0 },
      },
    });

    const event = await trap.waitForEvent({ timeoutMs: 90_000 });

    expect(event.detailType).toBe('RECONCILIATION_COMPLETED');
  }, 120_000);
});
