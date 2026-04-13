import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  funded,
  withHoldings,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '..';

describe('scenario 13 — reconciliation discrepancy surfaces corrective decision', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [
      onboarded(),
      funded({ cashBalanceCents: 2_000_000 }),
      withHoldings([
        { symbol: 'VTI', quantity: 50, fillPrice: 200 },
        { symbol: 'BND', quantity: 20, fillPrice: 80 },
      ]),
    ]);
  }, 240_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('ALPACA_ACCOUNT_SNAPSHOT with different quantities triggers drift → advisory decision', async () => {
    const bff = bffClient(ctx, tenant);
    const eb = new EventBridgeClient(ctx);

    // Wait for PORTFOLIO_UPDATED to propagate through ledger-ctrl CDC →
    // ledger-adpt → reconciliation-ctrl (seeds Intent cache).
    // withHoldings publishes ORDER_FILLED → ledger-ctrl reducer → PortfolioEvent →
    // CDC → PORTFOLIO_UPDATED → reconciliation-ctrl caches Intent side.
    // Give CDC chain 30 seconds to materialize.
    await new Promise((r) => setTimeout(r, 30_000));

    // TRIGGER: publish broker snapshot with DIFFERENT quantities (settlement side)
    // VTI: broker says 45 (intent says 50) → drift = +5
    // BND: broker says 25 (intent says 20) → drift = -5
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'reconciliation-ctrl',
      detailType: 'ALPACA_ACCOUNT_SNAPSHOT',
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        portfolioId: tenant.tenantId,
        positions: [
          { symbol: 'VTI', qty: 45, marketValue: 9000 },
          { symbol: 'BND', qty: 25, marketValue: 2000 },
        ],
      },
    });

    // ASSERT: drift detection → PORTFOLIO_DRIFT_DETECTED → advisory-ctrl →
    // decision surfaces in getDecisionHistory
    const history = await waitForGraphQL<{
      getDecisionHistory: { items: Array<{ decisionId: string; trigger: string; status: string }>; nextCursor: string | null };
    }>(
      bff.advisory,
      `query History { getDecisionHistory(limit: 10) { items { decisionId trigger status } nextCursor } }`,
      {},
      (r) => r.getDecisionHistory.items.some((d) => d.trigger === 'PORTFOLIO_DRIFT_DETECTED'),
      { timeoutMs: 240_000, intervalMs: 5_000 },
    );

    const decision = history.getDecisionHistory.items.find((d) => d.trigger === 'PORTFOLIO_DRIFT_DETECTED');
    expect(decision).toBeDefined();
    expect(decision!.decisionId).toEqual(expect.any(String));
  });
});
