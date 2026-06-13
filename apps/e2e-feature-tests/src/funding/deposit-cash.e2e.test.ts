import { randomUUID } from 'crypto';
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

/**
 * Scenario: investor deposits cash through the REAL sim funding pipeline.
 *
 * Pipeline under test (no synthetic events injected):
 *   initiateDeposit mutation
 *   → DepositIntent DDB write → CDC → DEPOSIT_INITIATED on investor bus
 *   → execution-adpt routes to broker-ctrl router
 *   → broker-ctrl router emits SIM_DEPOSIT_INITIATED on execution bus
 *   → broker-sim-adpt records DepositDetected → CDC → SIM_DEPOSIT_COMPLETED
 *   → broker-ctrl normalizer writes DEPOSIT_DETECTED (v2) + DEPOSIT_SETTLED (v3)
 *     FundingEvent rows → CDC → investor-adpt forwards both to investor bus
 *   → dashboard-bff event-listener handles DEPOSIT_DETECTED → records Activity row
 *   → getRecentActivity surfaces an entry with activityType='DEPOSIT_DETECTED'
 *
 * Assertion target: dashboard-bff's getRecentActivity query.
 * Evidence: dashboard-bff/src/handlers/event-listener.ts line 49-50 subscribes to
 * InvestorIngestEventTypes.DEPOSIT_DETECTED and routes it to recentActivity();
 * recent-activity.ts line 28 maps DEPOSIT_DETECTED → description "Deposit detected: …".
 * The DEPOSIT_DETECTED event arrives on the investor bus via investor-adpt (service.stack.ts
 * line 72 — ingress subscription) which forwards it from the execution bus after
 * broker-ctrl's normalizer emits it as a FundingEvent CDC row.
 *
 * CONTRAST with withdraw-cash.e2e.test.ts: that test INJECTS a synthetic
 * WITHDRAWAL_SETTLED because the withdrawal pipeline has no sim path yet.
 * This test MUST NOT inject any synthetic events — the real chain drives everything.
 *
 * NOTE: `DepositInput.depositId` is caller-generated (UUIDv4 required by the
 * AppSync resolver's UUID v4 regex validation). The resolver returns status='INITIATED',
 * not 'REQUESTED' — see initiate-deposit.fn.js and the integration test at line 412.
 */

describe('scenario — investor deposits cash (real sim funding pipeline)', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;

  /**
   * Re-enable the only feature flag this scenario exercises (initiateDeposit) —
   * guards against stale state from a prior run (e.g. a circuit-breaker scenario
   * that disabled it without re-enabling it).
   */
  async function resetFeatureFlags() {
    const flagTable = await ctx.ssm.tableName('investor-bff');
    const flagDdb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: ctx.region }));
    await flagDdb.send(new PutCommand({
      TableName: flagTable,
      Item: { pk: 'FeatureFlag#SYSTEM', sk: 'FeatureFlag#initiateDeposit', __typename: 'FeatureFlag', name: 'initiateDeposit', enabled: true, reason: null },
    }));
    flagDdb.destroy();
  }

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    await resetFeatureFlags();
    // onboarded() defaults to simulation mode (accountMode='simulation'), which is
    // the pre-condition for broker-sim-adpt to handle the DEPOSIT_INITIATED event.
    await applyFixtures(ctx, tenant, [onboarded()]);
  }, 600_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('initiateDeposit flows through the real broker-sim pipeline to a DEPOSIT_DETECTED activity entry', async () => {
    const bff = bffClient(ctx, tenant);

    // DepositInput.depositId is caller-generated (UUIDv4) — required by the
    // AppSync resolver's UUID v4 regex guard (initiate-deposit.fn.js line 11-12).
    const depositId = randomUUID();

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
      { input: { depositId, amountCents: 250_000, currency: 'USD' } },
    );

    // The resolver returns INITIATED (not REQUESTED — the Deposit P1 read-model row
    // written by broker-ctrl lifecycle events uses DETECTED/SETTLED/FAILED, but the
    // DepositIntent outbox row returned here is always INITIATED).
    expect(deposit.initiateDeposit.status).toBe('INITIATED');
    expect(deposit.initiateDeposit.depositId).toBe(depositId);
    expect(deposit.initiateDeposit.amountCents).toBe(250_000);

    // NO synthetic event injection. The real chain is:
    //   DepositIntent DDB row → CDC → DEPOSIT_INITIATED (investor-bff egress)
    //   → execution-adpt routes to broker-ctrl
    //   → broker-ctrl router: SIM_DEPOSIT_INITIATED → broker-sim-adpt
    //   → broker-sim-adpt: DepositDetected DDB row → CDC → SIM_DEPOSIT_COMPLETED
    //   → broker-ctrl normalizer: DEPOSIT_DETECTED (v2) + DEPOSIT_SETTLED (v3) carriers
    //   → investor-adpt forwards both to investor bus
    //   → dashboard-bff event-listener: DEPOSIT_DETECTED → recentActivity() → Activity row
    //   → getRecentActivity surfaces activityType='DEPOSIT_DETECTED'
    //
    // Timeout is 240s: each EB/CDC hop is 5–15s; the SIM path has no LLM calls
    // but traverses ~6 hops (DEPOSIT_INITIATED → exec-adpt → broker-ctrl →
    // SIM_DEPOSIT_INITIATED → broker-sim → SIM_DEPOSIT_COMPLETED → broker-ctrl
    // normalizer → DEPOSIT_DETECTED/SETTLED → investor-adpt → investor-bus →
    // dashboard-bff → DDB → GraphQL). 240s leaves comfortable headroom.
    const dashboard = await waitForGraphQL<RecentActivityResponse>(
      bff.dashboard,
      `query RecentActivity { getRecentActivity(limit: 20) { activityType description createdAt metadata } }`,
      {},
      // Exact match: dashboard-bff sets activityType = event.type, and DEPOSIT_DETECTED
      // is the ONLY deposit event it subscribes to (event-listener.ts line 49-50). An
      // exact === guards against a future mis-wiring that emits some other DEPOSIT_* type.
      (r) => r.getRecentActivity.some((e) => e.activityType === 'DEPOSIT_DETECTED'),
      { timeoutMs: 240_000 },
    );

    expect(
      dashboard.getRecentActivity.some((e) => e.activityType === 'DEPOSIT_DETECTED'),
    ).toBe(true);
  });
});
