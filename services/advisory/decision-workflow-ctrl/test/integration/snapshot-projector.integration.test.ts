import { randomUUID } from 'node:crypto';
import {
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  TableAssertions,
} from '@nestfolio/integration-testing';

/**
 * decision-workflow-ctrl SnapshotProjectorIngress integration — verifies the
 * DWC-local projections materialised from IP-ctrl and MI-ctrl snapshot events
 * (Task 8 of advisory-cycle-agent-precomputation).
 *
 * Subscriptions (declared in DWC service.stack.ts → SnapshotProjectorIngress):
 *   - INVESTOR_PROFILE_SNAPSHOT_CREATED → record(InvestorProfileSnapshot)
 *       pk=`InvestorProfileSnapshot#${tenantId}#${userId}` sk='InvestorProfileSnapshot'
 *   - INVESTOR_PROFILE_SNAPSHOT_UPDATED → update(InvestorProfileSnapshot)
 *   - MARKET_SNAPSHOT_UPDATED → record(MarketSnapshot)
 *       pk=`MarketSnapshot#${region}` sk='MarketSnapshot'
 *
 * The handler routes through materializeToTable; missing subject.agentOutput
 * throws NotRetryableError (surfaces via observability — the row is NOT
 * materialised, which is what the negative test asserts).
 *
 * This test publishes synthetic envelopes directly onto the advisory bus
 * (no upstream service needed) and asserts the projected rows land in DWC's
 * own State table.
 */
describe('decision-workflow-ctrl SnapshotProjectorIngress', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  // ── IP snapshot CREATED → InvestorProfileSnapshot row ──────────────

  it('projects InvestorProfileSnapshot on INVESTOR_PROFILE_SNAPSHOT_CREATED', async () => {
    const userId = `proj-ip-user-${randomUUID()}`;
    const sourceEventId = `proj-ip-source-${randomUUID()}`;

    const agentOutput = {
      riskTolerance: 'MODERATE',
      riskScore: 55,
      goalSummary: 'integration projection test',
    };

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'INVESTOR_PROFILE_SNAPSHOT_CREATED',
      detail: {
        tenantId: ctx.tenantId,
        userId,
        agentOutput,
        sourceEventId,
        sourceEventType: 'INVESTOR_PROFILE_UPDATED',
      },
    });

    const row = await table.waitForItem({
      table: 'decision-workflow-ctrl',
      pk: `InvestorProfileSnapshot#${ctx.tenantId}#${userId}`,
      sk: 'InvestorProfileSnapshot',
      timeoutMs: 60_000,
    });

    expect(row['__typename']).toBe('InvestorProfileSnapshot');
    expect(row['tenantId']).toBe(ctx.tenantId);
    expect(row['userId']).toBe(userId);
    expect(row['sourceEventId']).toBe(sourceEventId);
    expect(row['agentOutput']).toEqual(agentOutput);
  }, 90_000);

  // ── IP snapshot UPDATED → patch InvestorProfileSnapshot row ──────

  it('updates InvestorProfileSnapshot on INVESTOR_PROFILE_SNAPSHOT_UPDATED', async () => {
    const userId = `proj-ip-upd-user-${randomUUID()}`;

    // Seed via CREATED first.
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'INVESTOR_PROFILE_SNAPSHOT_CREATED',
      detail: {
        tenantId: ctx.tenantId,
        userId,
        agentOutput: { riskScore: 30 },
        sourceEventId: `seed-${randomUUID()}`,
        sourceEventType: 'INVESTOR_PROFILE_UPDATED',
      },
    });
    const seeded = await table.waitForItem({
      table: 'decision-workflow-ctrl',
      pk: `InvestorProfileSnapshot#${ctx.tenantId}#${userId}`,
      sk: 'InvestorProfileSnapshot',
      timeoutMs: 60_000,
    });
    expect((seeded['agentOutput'] as Record<string, unknown>)['riskScore']).toBe(30);
    const seededUpdatedAt = seeded['updatedAt'];

    // Then publish UPDATED with a different riskScore.
    await new Promise((r) => setTimeout(r, 1_000));
    const updatedAgentOutput = { riskScore: 85, raised: true };
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'INVESTOR_PROFILE_SNAPSHOT_UPDATED',
      detail: {
        tenantId: ctx.tenantId,
        userId,
        agentOutput: updatedAgentOutput,
        sourceEventId: `upd-${randomUUID()}`,
        sourceEventType: 'OPERATING_MODE_CHANGED',
      },
    });

    const updated = await table.waitForItem({
      table: 'decision-workflow-ctrl',
      pk: `InvestorProfileSnapshot#${ctx.tenantId}#${userId}`,
      sk: 'InvestorProfileSnapshot',
      predicate: (item) =>
        (item['agentOutput'] as Record<string, unknown> | undefined)?.['riskScore'] === 85,
      description: 'agentOutput.riskScore advances to 85',
      timeoutMs: 60_000,
    });

    expect((updated['agentOutput'] as Record<string, unknown>)['riskScore']).toBe(85);
    expect((updated['agentOutput'] as Record<string, unknown>)['raised']).toBe(true);
    expect(updated['updatedAt']).not.toBe(seededUpdatedAt);
  }, 120_000);

  // ── Market snapshot UPDATED → MarketSnapshot row ──────────────────

  it('projects MarketSnapshot on MARKET_SNAPSHOT_UPDATED', async () => {
    const region = `integ-region-${randomUUID().slice(0, 8)}`;
    const agentOutput = {
      regime: 'RISK_ON',
      summary: 'projection test',
      signals: [],
    };

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'MARKET_SNAPSHOT_UPDATED',
      detail: {
        region,
        agentOutput,
      },
    });

    const row = await table.waitForItem({
      table: 'decision-workflow-ctrl',
      pk: `MarketSnapshot#${region}`,
      sk: 'MarketSnapshot',
      timeoutMs: 60_000,
    });

    expect(row['__typename']).toBe('MarketSnapshot');
    expect(row['region']).toBe(region);
    expect(row['agentOutput']).toEqual(agentOutput);
  }, 90_000);

  // ── Negative: missing agentOutput → no row written ──────────────

  it('does NOT project a row when MARKET_SNAPSHOT_UPDATED is missing subject.agentOutput', async () => {
    const region = `integ-noagent-${randomUUID().slice(0, 8)}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'MARKET_SNAPSHOT_UPDATED',
      detail: {
        region,
        // agentOutput intentionally omitted → snapshot-projector throws
        // NotRetryableError; materializeToTable surfaces it through
        // observability and the row is NOT written.
      },
    });

    await new Promise((r) => setTimeout(r, 30_000));

    await expect(
      table.waitForItem({
        table: 'decision-workflow-ctrl',
        pk: `MarketSnapshot#${region}`,
        sk: 'MarketSnapshot',
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(/timeout waiting for item/);
  }, 120_000);
});
