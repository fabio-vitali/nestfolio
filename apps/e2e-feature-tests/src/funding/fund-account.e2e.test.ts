import {
  createTestContext,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '..';
import type { RecentActivityResponse } from '../helpers/graphql-types';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

describe('scenario 1 — investor funds their account', () => {
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
    await applyFixtures(ctx, tenant, [onboarded()]);
  }, 600_000);

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
      { input: { depositId: randomUUID(), amountCents: 500_000, currency: 'USD' } },
    );

    expect(deposit.initiateDeposit.status).toBe('INITIATED');
    expect(deposit.initiateDeposit.amountCents).toBe(500_000);

    const dashboard = await waitForGraphQL<RecentActivityResponse>(
      bff.dashboard,
      `query RecentActivity { getRecentActivity(limit: 20) { activityType description createdAt metadata } }`,
      {},
      (r) => r.getRecentActivity.some((e) => e.activityType.toUpperCase().includes('DEPOSIT')),
      { timeoutMs: 180_000 },
    );
    expect(dashboard.getRecentActivity.some((e) => e.activityType.toUpperCase().includes('DEPOSIT'))).toBe(true);
  });
});
