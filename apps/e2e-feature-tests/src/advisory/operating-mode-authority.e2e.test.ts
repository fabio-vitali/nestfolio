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
 *   1. onboarded(mode, mandateLevel: 'DISCRETIONARY') → investor-bff writes the
 *      composite InvestorProfile row (operatingMode on the row) + sibling Mandate
 *      row (slim: mandateId, level, status, operatingMode, effectiveDate) → CDC
 *      emits INVESTOR_PROFILE_CREATED → advisory-adpt forwards to AdvisoryBus →
 *      compliance-ctrl materializes MandateSnapshot{level, status, operatingMode, effectiveDate}.
 *   2. Synthetic RECOMMENDATION_PROPOSED on advisory bus carrying a controlled
 *      proposedTrade size + a unique decisionPacketId + a fake taskToken.
 *   3. compliance-ctrl ingests, runs RuleEngine — guardrail thresholds are derived
 *      at evaluation time via resolveGuardrailParams(mandate.operatingMode), not
 *      stored as numeric fields on MandateSnapshot.
 *   4. The test reads the ComplianceCheck row back, filtered by decisionPacketId
 *      (so the SF auto-pipeline's RECOMMENDATION_PROPOSED — also fired by the
 *      onboarding's Mandate write — doesn't race against the test's row).
 *
 * A 6 % trade should resolve (thresholds from resolveGuardrailParams):
 *   - L2 in CONSERVATIVE (maxSingleTradePercent = 5 %, trade exceeds threshold → L2)
 *   - L1 in BALANCED    (maxSingleTradePercent = 10 %, trade within threshold → L1)
 *   - L1 in AGGRESSIVE  (maxSingleTradePercent = 20 %, trade within threshold → L1)
 *
 * The mandateLevel: 'DISCRETIONARY' override is required because the default
 * for e2e tenants is ADVISORY (forces L2 regardless of mode — see
 * services/investor/investor-bff/src/transforms/onboarding-completed.ts).
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

/** Poll compliance-ctrl DDB for a ComplianceCheck record matching tenantId + decisionPacketId (max 120 s). */
async function waitForComplianceCheck(
  ddbDoc: DynamoDBDocumentClient,
  tableName: string,
  tenantId: string,
  decisionPacketId: string,
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
    const match = result.Items?.find((item) => item['decisionPacketId'] === decisionPacketId);
    if (match) {
      return match;
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`ComplianceCheck not found for tenantId=${tenantId}, decisionPacketId=${decisionPacketId} within 120 s`);
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

    // Seed onboarded state with DISCRETIONARY mandate so authority resolution
    // depends on mode-derived guardrail params, not on the e2e-prefix ADVISORY default.
    await applyFixtures(ctx, tenant, [
      onboarded({ operatingMode: mode, capitalAmount: CAPITAL_AMOUNT, mandateLevel: 'DISCRETIONARY' }),
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
    const decisionId = `e2e-decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Publish RECOMMENDATION_PROPOSED to advisory bus targeting compliance-ctrl.
    // taskToken is required by compliance-ctrl's handler (NotRetryableError otherwise);
    // we use a fake token because we don't care about the SF callback in this test —
    // we only assert on the ComplianceCheck row written by compliance-ctrl.
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: DecisionWorkflowEventTypes.RECOMMENDATION_PROPOSED,
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        decisionId,
        taskToken: `e2e-fake-token-${decisionId}`,
        awaitingCompliance: true,
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

    // Wait for compliance-ctrl to write a ComplianceCheck record matching this
    // specific decisionId — filters out the row the SF auto-pipeline writes
    // for the Mandate-driven decision (which uses agent-proposed trades, not ours).
    const check = await waitForComplianceCheck(ddbDoc, complianceTableName, tenant.tenantId, decisionId);

    expect(check.authorityLevel).toBe(expectedAuthority);
  }, 180_000);
});
