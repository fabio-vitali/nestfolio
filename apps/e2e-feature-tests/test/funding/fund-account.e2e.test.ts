import {
  createIntegrationContext,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '../../src';

describe('scenario 1 — investor funds their account', () => {
  let ctx: IntegrationContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [onboarded()]);
  }, 120_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('initiateDeposit surfaces a pending deposit on the dashboard + activity feed', async () => {
    const bff = bffClient(ctx, tenant);

    const deposit = await bff.investor.mutate<{
      initiateDeposit: { depositId: string; amountCents: number; currency: string; status: string; initiatedAt: string };
    }>(
      `mutation InitiateDeposit($input: DepositInput!) {
         initiateDeposit(input: $input) {
           depositId
           amountCents
           currency
           status
           initiatedAt
         }
       }`,
      { input: { amountCents: 500_000, currency: 'USD' } },
    );

    expect(deposit.initiateDeposit.status).toBe('INITIATED');
    expect(deposit.initiateDeposit.amountCents).toBe(500_000);

    const dashboard = await waitForGraphQL<{
      getRecentActivity: Array<{ activityType: string; description: string; createdAt: string; metadata: string | null }>;
    }>(
      bff.dashboard,
      `query RecentActivity { getRecentActivity(limit: 20) { activityType description createdAt metadata } }`,
      {},
      (r) => r.getRecentActivity.some((e) => e.activityType.toUpperCase().includes('DEPOSIT')),
      { timeoutMs: 180_000 },
    );
    expect(dashboard.getRecentActivity.some((e) => e.activityType.toUpperCase().includes('DEPOSIT'))).toBe(true);
  });
});
