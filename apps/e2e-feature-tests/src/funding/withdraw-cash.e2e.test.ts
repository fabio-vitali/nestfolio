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
import type { RecentActivityResponse } from '../helpers/graphql-types';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

describe('scenario 2 — investor withdraws cash', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;

  // Ensure feature flags are enabled — guards against stale state from prior test runs
  async function resetFeatureFlags() {
    const flagTable = await ctx.ssm.tableName('investor-bff');
    const flagDdb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: ctx.region }));
    const flags = ['confirmDecision', 'initiateDeposit', 'requestWithdrawal'];
    await Promise.all(flags.map(name =>
      flagDdb.send(new PutCommand({
        TableName: flagTable,
        Item: { pk: 'FeatureFlag#SYSTEM', sk: `FeatureFlag#${name}`, __typename: 'FeatureFlag', name, enabled: true, reason: null },
      })),
    ));
    flagDdb.destroy();
  }

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    await resetFeatureFlags();
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

    // funded() now polls for CashBalance materialization, so the mutation
    // can be called directly without retrying on InsufficientFundsError.
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

    const dashboard = await waitForGraphQL<RecentActivityResponse>(
      bff.dashboard,
      `query RecentActivity { getRecentActivity(limit: 20) { activityType description createdAt metadata } }`,
      {},
      (r) => r.getRecentActivity.some((e) => e.activityType.toUpperCase().includes('WITHDRAWAL')),
      { timeoutMs: 180_000 },
    );
    expect(dashboard.getRecentActivity.some((e) => e.activityType.toUpperCase().includes('WITHDRAWAL'))).toBe(true);
  });
});
