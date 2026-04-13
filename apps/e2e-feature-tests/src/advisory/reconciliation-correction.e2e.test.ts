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
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

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

    // Resolve reconciliation-ctrl table for verification
    const tableName = await ctx.ssm.tableName('reconciliation-ctrl');
    const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: ctx.region }));

    // Wait for PORTFOLIO_UPDATED to propagate through ledger-ctrl CDC →
    // reconciliation-ctrl (seeds Intent cache).
    // Give CDC chain 60 seconds to materialize.
    await new Promise((r) => setTimeout(r, 60_000));

    // VERIFY: Intent cache was seeded
    const intentBefore = await ddbDoc.send(new GetCommand({
      TableName: tableName,
      Key: { pk: `PositionCache#${tenant.tenantId}`, sk: 'Intent' },
    }));
    console.log('[scenario-13] Intent cache before trigger:', JSON.stringify(intentBefore.Item ?? null));

    // TRIGGER: publish broker snapshot with DIFFERENT quantities (settlement side)
    console.log('[scenario-13] Publishing ALPACA_ACCOUNT_SNAPSHOT for tenant', tenant.tenantId);
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
    console.log('[scenario-13] putEvent completed successfully');

    // Wait for event to be processed by Lambda
    await new Promise((r) => setTimeout(r, 15_000));

    // VERIFY: Settlement cache was written (confirms event reached Lambda)
    const settlementAfter = await ddbDoc.send(new GetCommand({
      TableName: tableName,
      Key: { pk: `PositionCache#${tenant.tenantId}`, sk: 'Settlement' },
    }));
    console.log('[scenario-13] Settlement cache after trigger:', JSON.stringify(settlementAfter.Item ?? null));

    if (!settlementAfter.Item) {
      // Check if there are any PositionCache items for this tenant at all
      console.log('[scenario-13] WARNING: Settlement cache NOT written — event may not have reached Lambda');
    }

    // ASSERT: drift detection → PORTFOLIO_DRIFT_DETECTED → advisory-ctrl →
    // decision surfaces in getDecisionHistory
    const history = await waitForGraphQL<{
      getDecisionHistory: { items: Array<{ decisionId: string; trigger: string; status: string }>; nextCursor: string | null };
    }>(
      bff.advisory,
      `query History { getDecisionHistory(limit: 10) { items { decisionId trigger status } nextCursor } }`,
      {},
      (r) => r.getDecisionHistory.items.some((d) => d.trigger === 'PORTFOLIO_DRIFT_DETECTED'),
      { timeoutMs: 180_000, intervalMs: 5_000 },
    );

    const decision = history.getDecisionHistory.items.find((d) => d.trigger === 'PORTFOLIO_DRIFT_DETECTED');
    expect(decision).toBeDefined();
    expect(decision!.decisionId).toEqual(expect.any(String));
  });
});
