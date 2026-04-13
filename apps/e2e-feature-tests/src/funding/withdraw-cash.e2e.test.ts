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
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '..';

describe('scenario 2 — investor withdraws cash', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [
      onboarded(),
      funded({ cashBalanceCents: 2_000_000 }),
    ]);
  }, 120_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('requestWithdrawal surfaces a withdrawal entry on the activity feed', async () => {
    const bff = bffClient(ctx, tenant);

    // Retry the mutation until BALANCE_UPDATED has been materialized. The
    // funded() fixture publishes BALANCE_UPDATED but the CashBalance row may
    // not exist yet when the mutation runs (eventual consistency). Retrying
    // on InsufficientFundsError is safe — the resolver throws before writing.
    const deadline = Date.now() + 60_000;
    let withdrawal: { requestWithdrawal: { withdrawalId: string; amountCents: number; currency: string; status: string; requestedAt: string } } | undefined;
    while (Date.now() < deadline) {
      try {
        withdrawal = await bff.investor.mutate<{
          requestWithdrawal: { withdrawalId: string; amountCents: number; currency: string; status: string; requestedAt: string };
        }>(
          `mutation RequestWithdrawal($input: WithdrawalInput!) {
             requestWithdrawal(input: $input) {
               withdrawalId
               amountCents
               currency
               status
               requestedAt
             }
           }`,
          { input: { amountCents: 250_000, currency: 'USD' } },
        );
        break;
      } catch (err) {
        if (!(err instanceof Error) || !err.message.includes('InsufficientFunds')) throw err;
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }
    if (!withdrawal) throw new Error('requestWithdrawal did not succeed within 60s — BALANCE_UPDATED may not have materialized');

    expect(withdrawal.requestWithdrawal.status).toBe('REQUESTED');
    expect(withdrawal.requestWithdrawal.amountCents).toBe(250_000);

    // Simulate the downstream completion: in the real system, broker-ctrl processes
    // the withdrawal and eventually emits WITHDRAWAL_COMPLETED on the execution bus,
    // which investor-adpt forwards to the investor bus. Dashboard-bff subscribes to
    // WITHDRAWAL_COMPLETED (not WITHDRAWAL_REQUESTED) so the activity entry only
    // appears after the withdrawal is processed.
    const eb = new EventBridgeClient(ctx);
    await eb.putEvent({
      bus: 'investor',
      targetService: 'dashboard-bff',
      detailType: 'WITHDRAWAL_COMPLETED',
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        withdrawalId: withdrawal.requestWithdrawal.withdrawalId,
        amountCents: 250_000,
        currency: 'USD',
      },
    });

    const dashboard = await waitForGraphQL<{
      getRecentActivity: Array<{ activityType: string; description: string; createdAt: string; metadata: string | null }>;
    }>(
      bff.dashboard,
      `query RecentActivity { getRecentActivity(limit: 20) { activityType description createdAt metadata } }`,
      {},
      (r) => r.getRecentActivity.some((e) => e.activityType.toUpperCase().includes('WITHDRAWAL')),
      { timeoutMs: 180_000 },
    );
    expect(dashboard.getRecentActivity.some((e) => e.activityType.toUpperCase().includes('WITHDRAWAL'))).toBe(true);
  });
});
