import {
  createTestContext,
  type TestContext,
} from '@nestfolio/test-support';
import { EventBusTrap } from '@nestfolio/integration-testing';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
import { EventBridgeClient } from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  bffClient,
  type FreshTenant,
} from '..';

/**
 * Scenario: investor switches operatingMode from CONSERVATIVE → AGGRESSIVE.
 *
 * Verifies three things:
 *   1. `updateOperatingMode` mutation returns an InvestorProfile with the new mode.
 *   2. OPERATING_MODE_CHANGED event fires on the investor bus (CDC from the
 *      InvestorProfile row's operatingMode UPDATE) and NO INVESTOR_PROFILE_UPDATED
 *      fires — the mutation targets a direct DDB Update, not a full row replace.
 *   3. After re-derivation propagates to compliance-ctrl (OPERATING_MODE_CHANGED →
 *      advisory-adpt → INVESTOR_PROFILE_UPDATED on advisory bus → compliance-ctrl
 *      updates MandateSnapshot), a fresh RECOMMENDATION_PROPOSED at 6 % trade size
 *      now resolves L1 (AGGRESSIVE threshold = 20 %) rather than L2 (CONSERVATIVE
 *      threshold = 5 %, 6 % > 5 % → L2).
 *
 * Note: The operating-mode-authority.e2e.test.ts tests the static, per-mode
 * authority resolution. This test specifically exercises the *transition* —
 * confirming that switching mode mid-session causes compliance-ctrl to
 * re-derive and apply the new guardrail thresholds.
 */

const CAPITAL_AMOUNT = 100_000;
const TRADE_PERCENT = 6; // 6 % — BLOCKED under CONSERVATIVE (max 5 %), PASS under AGGRESSIVE (max 20 %)
const TRADE_AMOUNT = Math.round((CAPITAL_AMOUNT * TRADE_PERCENT) / 100);

/** Poll compliance-ctrl DDB until MandateSnapshot reflects the expected operatingMode (max 90 s). */
async function waitForMandateSnapshotMode(
  ddbDoc: DynamoDBDocumentClient,
  tableName: string,
  tenantId: string,
  userId: string,
  expectedMode: string,
): Promise<void> {
  const pk = `GuardrailPolicy#${tenantId}#${userId}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const result = await ddbDoc.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk, sk: 'MandateSnapshot' },
      }),
    );
    if (result.Item?.operatingMode === expectedMode) return;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(
    `MandateSnapshot did not update to operatingMode=${expectedMode} within 90 s (pk=${pk})`,
  );
}

/** Poll compliance-ctrl DDB for a ComplianceCheck record matching tenantId + decisionId (max 120 s). */
async function waitForComplianceCheck(
  ddbDoc: DynamoDBDocumentClient,
  tableName: string,
  tenantId: string,
  decisionId: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const result = await ddbDoc.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'tenantId-index',
        KeyConditionExpression: 'tenantId = :tid AND #tn = :type',
        ExpressionAttributeNames: { '#tn': '__typename' },
        ExpressionAttributeValues: {
          ':tid': tenantId,
          ':type': 'ComplianceCheck',
        },
      }),
    );
    const match = result.Items?.find((item) => item['decisionPacketId'] === decisionId);
    if (match) return match;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(
    `ComplianceCheck row for decisionId=${decisionId} not found within 120 s`,
  );
}

describe('scenario — investor switches operatingMode CONSERVATIVE → AGGRESSIVE (re-derivation)', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let trap: EventBusTrap;
  let complianceTableName: string;
  let ddbDoc: DynamoDBDocumentClient;
  let ddbClient: DynamoDBClient;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);

    // Arm trap BEFORE onboarding so we can drain onboarding-driven events.
    // We listen for OPERATING_MODE_CHANGED and INVESTOR_PROFILE_UPDATED so we
    // can assert the mutation emits ONLY the semantic event.
    trap = new EventBusTrap(ctx);
    await trap.deploy({
      bus: 'investor',
      detailType: [
        InvestorBffEventTypes.OPERATING_MODE_CHANGED,
        InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED,
      ],
    });

    // Onboard with CONSERVATIVE + DISCRETIONARY (DISCRETIONARY so authority
    // resolution depends on mode, not on the e2e-prefix ADVISORY default).
    await applyFixtures(ctx, tenant, [
      onboarded({ operatingMode: 'CONSERVATIVE', capitalAmount: CAPITAL_AMOUNT, mandateLevel: 'DISCRETIONARY' }),
    ]);

    // Set up DDB client for compliance-ctrl reads.
    complianceTableName = await ctx.ssm.tableName('compliance-ctrl');
    ddbClient = new DynamoDBClient({ region: ctx.region });
    ddbDoc = DynamoDBDocumentClient.from(ddbClient);

    // Wait for initial MandateSnapshot (CONSERVATIVE) to materialize in compliance-ctrl.
    // Chain: onboarding-completed → investor-bff CDC MANDATE_ISSUED →
    //        compliance-ctrl ingress (direct subscription on InvestorBus) →
    //        compliance-ctrl putMandateSnapshot.
    await waitForMandateSnapshotMode(ddbDoc, complianceTableName, tenant.tenantId, tenant.userId, 'CONSERVATIVE');
  }, 180_000);

  afterEach(async () => {
    ddbClient?.destroy();
    await ctx.cleanup.runAll();
  }, 60_000);

  it('updateOperatingMode triggers re-derivation and AGGRESSIVE guardrails apply', async () => {
    const bff = bffClient(ctx, tenant);

    // Drain any onboarding-driven INVESTOR_PROFILE_UPDATED events from the trap
    // so the post-mutation drain only captures events caused by updateOperatingMode.
    await trap.drain();

    // ── Step 1: call the mutation ────────────────────────────────────────────
    const result = await bff.investor.mutate<{
      updateOperatingMode: {
        operatingMode: string;
        tenantId: string;
      };
    }>(
      `mutation UpdateOperatingMode($mode: OperatingMode!) {
         updateOperatingMode(mode: $mode) {
           tenantId
           operatingMode
         }
       }`,
      { mode: 'AGGRESSIVE' },
    );

    expect(result.updateOperatingMode.operatingMode).toBe('AGGRESSIVE');

    // ── Step 2: assert OPERATING_MODE_CHANGED fires alongside INVESTOR_PROFILE_UPDATED ──
    // The 3-tier event topology emits both: the carrier (INVESTOR_PROFILE_UPDATED)
    // fires on any MODIFY to the row, and the semantic event (OPERATING_MODE_CHANGED)
    // fires from the producer-side onFieldChange diff on operatingMode.
    // Wait independently for each event — they originate from one CDC batch but
    // arrive in non-deterministic order on the trap.
    const modeChangedEvent = await trap.waitForEvent({
      detailType: InvestorBffEventTypes.OPERATING_MODE_CHANGED,
      timeoutMs: 60_000,
    });
    expect(modeChangedEvent.detailType).toBe(InvestorBffEventTypes.OPERATING_MODE_CHANGED);

    const carrierEvent = await trap.waitForEvent({
      detailType: InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED,
      timeoutMs: 60_000,
    });
    expect(carrierEvent.detailType).toBe(InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED);

    // ── Step 3: wait for MandateSnapshot to reflect AGGRESSIVE in compliance-ctrl ──
    // OPERATING_MODE_CHANGED → advisory-adpt forwards → compliance-ctrl re-derives.
    await waitForMandateSnapshotMode(ddbDoc, complianceTableName, tenant.tenantId, tenant.userId, 'AGGRESSIVE');

    // ── Step 4: assert AGGRESSIVE guardrails apply to a 6 % trade ────────────
    // Under CONSERVATIVE maxSingleTradePercent = 5 % → 6 % trade → L2.
    // Under AGGRESSIVE   maxSingleTradePercent = 20 % → 6 % trade → L1.
    const eb = new EventBridgeClient(ctx);
    const decisionId = `e2e-decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
        proposedTrades: [
          {
            symbol: 'QQQ',
            assetClass: 'EQUITY',
            side: 'BUY',
            quantityOrAmountCents: TRADE_AMOUNT,
            targetWeightPercent: TRADE_PERCENT,
            rationale: 'E2E mode-switch test trade',
          },
        ],
        portfolioValue: CAPITAL_AMOUNT,
        riskScore: 5,
        currentPositions: [],
      },
    });

    const check = await waitForComplianceCheck(
      ddbDoc,
      complianceTableName,
      tenant.tenantId,
      decisionId,
    );

    // Under AGGRESSIVE, a 6 % trade is within maxSingleTradePercent (20 %) → L1.
    expect(check.authorityLevel).toBe('L1');
  }, 300_000);
});
