import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  type FreshTenant,
} from '..';

/**
 * Verifies that operating mode affects L1/L2 authority resolution
 * by driving the compliance-ctrl pipeline directly.
 *
 * Flow:
 *   1. onboarded(mode) → investor-bff writes Mandate → CDC emits MANDATE_CREATED
 *      → investor-adpt → advisory-adpt → compliance-ctrl materializes MandateSnapshot
 *   2. Synthetic DECISION_PACKET_CREATED on advisory bus → compliance-ctrl
 *   3. compliance-ctrl evaluates rules → writes ComplianceCheck with authorityLevel
 *
 * A 6 % trade should be:
 *   - L2 in CONSERVATIVE (maxSingleTradePercent = 5 %)
 *   - L1 in BALANCED    (maxSingleTradePercent = 10 %)
 *   - L1 in AGGRESSIVE  (maxSingleTradePercent = 20 %)
 */

const CAPITAL_AMOUNT = 100_000;
const TRADE_PERCENT = 6;
const TRADE_AMOUNT = Math.round((CAPITAL_AMOUNT * TRADE_PERCENT) / 100);

/** Poll compliance-ctrl DDB until MandateSnapshot appears (max 90 s). */
async function waitForMandateSnapshot(
  ddbDoc: DynamoDBDocumentClient,
  tableName: string,
  tenantId: string,
  userId: string,
): Promise<void> {
  const pk = `GuardrailPolicy#${tenantId}#${userId}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const result = await ddbDoc.send(new GetCommand({
      TableName: tableName,
      Key: { pk, sk: 'MandateSnapshot' },
    }));
    if (result.Item) return;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`MandateSnapshot not materialized in compliance-ctrl within 90 s (pk=${pk})`);
}

/** Poll compliance-ctrl DDB for a ComplianceCheck record matching tenantId (max 120 s). */
async function waitForComplianceCheck(
  ddbDoc: DynamoDBDocumentClient,
  tableName: string,
  tenantId: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const result = await ddbDoc.send(new QueryCommand({
      TableName: tableName,
      IndexName: 'tenantId-index',
      KeyConditionExpression: 'tenantId = :tid AND #tn = :type',
      ExpressionAttributeNames: { '#tn': '__typename' },
      ExpressionAttributeValues: {
        ':tid': tenantId,
        ':type': 'ComplianceCheck',
      },
    }));
    if (result.Items && result.Items.length > 0) {
      return result.Items[0];
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`ComplianceCheck not found for tenantId=${tenantId} within 120 s`);
}

describe.each([
  { mode: 'CONSERVATIVE' as const, expectedAuthority: 'L2' },
  { mode: 'BALANCED' as const, expectedAuthority: 'L1' },
  { mode: 'AGGRESSIVE' as const, expectedAuthority: 'L1' },
])('operating mode $mode — 6% trade', ({ mode, expectedAuthority }) => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let complianceTableName: string;
  let ddbDoc: DynamoDBDocumentClient;
  let ddbClient: DynamoDBClient;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);

    // Seed onboarded state — triggers Mandate creation with mode-derived guardrail params
    await applyFixtures(ctx, tenant, [
      onboarded({ operatingMode: mode, capitalAmount: CAPITAL_AMOUNT }),
    ]);

    // Set up DDB client for compliance-ctrl reads
    complianceTableName = await ctx.ssm.tableName('compliance-ctrl');
    ddbClient = new DynamoDBClient({ region: ctx.region });
    ddbDoc = DynamoDBDocumentClient.from(ddbClient);

    // Wait for MandateSnapshot to materialize in compliance-ctrl
    // (onboarded → investor-bff CDC → InvestorBus → advisory-adpt → AdvisoryBus → compliance-ctrl)
    await waitForMandateSnapshot(ddbDoc, complianceTableName, tenant.tenantId, tenant.userId);
  }, 180_000);

  afterEach(async () => {
    ddbClient?.destroy();
    await ctx.cleanup.runAll();
  }, 60_000);

  it(`authority is ${expectedAuthority}`, async () => {
    const eb = new EventBridgeClient(ctx);

    // Publish DECISION_PACKET_CREATED to advisory bus targeting compliance-ctrl
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: DecisionWorkflowEventTypes.DECISION_PACKET_CREATED,
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        decisionId: `e2e-decision-${Date.now()}`,
        proposedTrades: [{
          symbol: 'VTI',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: TRADE_AMOUNT,
          targetWeightPercent: TRADE_PERCENT,
          rationale: 'E2E test trade',
        }],
        portfolioValue: CAPITAL_AMOUNT,
        riskScore: 5,
        currentPositions: [],
      },
    });

    // Wait for compliance-ctrl to write a ComplianceCheck record
    const check = await waitForComplianceCheck(ddbDoc, complianceTableName, tenant.tenantId);

    expect(check.authorityLevel).toBe(expectedAuthority);
  }, 180_000);
});
