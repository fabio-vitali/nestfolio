import {
  createTestContext,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  funded,
  withBreakerOpen,
  closeBreakerFixture,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '..';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { FeatureFlagsResponse } from '../helpers/graphql-types';

describe('scenario 14 — circuit breaker lifecycle', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;

  // 180s: onboarded() + funded() fixture chain includes CDC propagation waits
  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [onboarded(), funded({ cashBalanceCents: 500_000 })]);
  }, 180_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('disables gated mutations when breaker opens and re-enables when breaker closes', async () => {
    const bff = bffClient(ctx, tenant);

    // ── Phase 1: Verify baseline — features work ─────────────────────
    const deposit = await bff.investor.mutate<{
      initiateDeposit: { depositId: string; status: string };
    }>(
      `mutation InitiateDeposit($input: DepositInput!) {
         initiateDeposit(input: $input) { depositId status }
       }`,
      { input: { amountCents: 100_000, currency: 'USD' } },
    );
    expect(deposit.initiateDeposit.status).toBe('INITIATED');

    // ── Phase 2: Open the breaker ────────────────────────────────────
    await applyFixtures(ctx, tenant, [withBreakerOpen()]);

    // Wait for feature flags to be disabled (CDC → execution-hub → investor-adpt → investor-bff)
    const disabledFlags = await waitForGraphQL<FeatureFlagsResponse>(
      bff.investor,
      `query { getFeatureFlags { name enabled reason } }`,
      {},
      (r) => r.getFeatureFlags.some(f => f.name === 'initiateDeposit' && !f.enabled),
      { timeoutMs: 120_000 },
    );
    expect(disabledFlags.getFeatureFlags.find(f => f.name === 'initiateDeposit')?.enabled).toBe(false);
    expect(disabledFlags.getFeatureFlags.find(f => f.name === 'requestWithdrawal')?.enabled).toBe(false);

    // Verify gated mutation is blocked
    try {
      await bff.investor.mutate<unknown>(
        `mutation InitiateDeposit($input: DepositInput!) {
           initiateDeposit(input: $input) { depositId status }
         }`,
        { input: { amountCents: 50_000, currency: 'USD' } },
      );
      fail('Expected mutation to be blocked by feature flag');
    } catch (err) {
      expect((err as Error).message).toContain('SERVICE_TEMPORARILY_UNAVAILABLE');
    }

    // ── Phase 3: Close the breaker ───────────────────────────────────
    await applyFixtures(ctx, tenant, [closeBreakerFixture()]);

    // Wait for feature flags to be re-enabled
    const enabledFlags = await waitForGraphQL<FeatureFlagsResponse>(
      bff.investor,
      `query { getFeatureFlags { name enabled reason } }`,
      {},
      (r) => {
        const flag = r.getFeatureFlags.find(f => f.name === 'initiateDeposit');
        return flag?.enabled === true;
      },
      { timeoutMs: 120_000 },
    );
    expect(enabledFlags.getFeatureFlags.find(f => f.name === 'initiateDeposit')?.enabled).toBe(true);

    // Verify gated mutation works again
    const deposit2 = await bff.investor.mutate<{
      initiateDeposit: { depositId: string; status: string };
    }>(
      `mutation InitiateDeposit($input: DepositInput!) {
         initiateDeposit(input: $input) { depositId status }
       }`,
      { input: { amountCents: 30_000, currency: 'USD' } },
    );
    expect(deposit2.initiateDeposit.status).toBe('INITIATED');
  }, 360_000); // full lifecycle — 6 min timeout

  it('creates system notifications for breaker open', async () => {
    // Open breaker
    await applyFixtures(ctx, tenant, [withBreakerOpen()]);

    // Wait for SYSTEM notification to appear via DDB query
    // (getNotifications GraphQL only returns tenant-scoped notifications, not SYSTEM)
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: ctx.region }));
    const tableName = await ctx.ssm.tableName('investor-ctrl');

    const deadline = Date.now() + 120_000;
    let found = false;
    while (Date.now() < deadline) {
      const result = await ddb.send(new QueryCommand({
        TableName: tableName,
        IndexName: 'tenantId-index',
        KeyConditionExpression: 'tenantId = :tid AND __typename = :tn',
        ExpressionAttributeValues: { ':tid': 'SYSTEM', ':tn': 'Notification' },
      }));
      if (result.Items?.some(i => i['type'] === 'BROKER_CIRCUIT_OPEN')) {
        found = true;
        break;
      }
      await new Promise(r => setTimeout(r, 3_000));
    }
    expect(found).toBe(true);
  }, 180_000);
});
