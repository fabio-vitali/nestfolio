import {
  createIntegrationContext,
  EventBridgeClient,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  funded,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '../../src';

describe('scenario 2 — investor withdraws cash', () => {
  let ctx: IntegrationContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [
      onboarded(),
      funded({ cashBalanceCents: 2_000_000 }),
    ]);
    // Wait for funded fixture's events to materialize — BALANCE_UPDATED must
    // propagate through EB → SQS → Lambda before requestWithdrawal can find
    // the CashBalance row (its ConditionExpression requires attribute_exists).
    const preflight = bffClient(ctx, tenant);
    await waitForGraphQL<{ getProfile: { tenantId: string } }>(
      preflight.investor,
      `query { getProfile { tenantId } }`,
      {},
      (r) => !!r.getProfile?.tenantId,
      { timeoutMs: 60_000 },
    );
    // Buffer for BALANCE_UPDATED (published after USER_REGISTERED in fixture sequence)
    await new Promise((r) => setTimeout(r, 5_000));
  }, 120_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('requestWithdrawal surfaces a withdrawal entry on the activity feed', async () => {
    const bff = bffClient(ctx, tenant);

    const withdrawal = await bff.investor.mutate<{
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
