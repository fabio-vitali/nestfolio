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
 *   - INVESTOR_PROFILE_SNAPSHOT_CREATED → projectVersioned(InvestorProfileSnapshot)
 *       pk=`InvestorProfileSnapshot#${tenantId}#${userId}` sk='InvestorProfileSnapshot'
 *   - INVESTOR_PROFILE_SNAPSHOT_UPDATED → projectVersioned(InvestorProfileSnapshot)
 *   - MARKET_SNAPSHOT_UPDATED → projectVersioned(MarketSnapshot)
 *       pk=`MarketSnapshot#${region}` sk='MarketSnapshot'
 *
 * Post-WS-C these are versioned P1 projections keyed on the upstream `__version`
 * carried top-level on the event subject (the IP/Market producers stamp it via
 * `update({ add: { __version: 1 } })`). Each synthetic event below MUST carry
 * `__version`; without it `projectVersioned` drops the event (no row written).
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
    // Identity is now a context-only field — the projector keys the row on
    // ctx.userId (the dry subject no longer carries userId). Pin a per-test
    // userId onto the shared context so this test's row is isolated and the
    // assertions below resolve against the row the handler actually writes.
    const userId = `proj-ip-user-${randomUUID()}`;
    ctx.userId = userId;
    const sourceEventId = `proj-ip-source-${randomUUID()}`;

    // Full InvestorProfileSnapshotSchema.agentOutput — composite shape required by
    // the producer schema parsed at the consumer parseSubject seam.
    // { decisionId, goals: GoalInterpretation, risk: RiskEvaluation, metadata }
    const agentOutput = {
      decisionId: 'dec-integ-proj',
      goals: {
        goals: ['retirement'],
        timeHorizon: 'LONG_TERM',
        riskWillingness: 'MODERATE',
        confidence: 0.9,
      },
      risk: {
        riskScore: 55,
        riskCategory: 'MODERATE' as const,
        regulatoryFlags: [],
        suitabilityAssessment: 'integration projection test',
        confidence: 0.9,
      },
      metadata: {
        durationMs: 1800,
        modelTiers: ['haiku', 'sonnet'],
      },
    };

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'INVESTOR_PROFILE_SNAPSHOT_CREATED',
      // Dry subject — identity (tenantId/userId) travels in the event context,
      // injected by eb.putEvent from ctx (ctx.userId pinned above for isolation).
      subject: {
        agentOutput,
        sourceEventId,
        __version: 1,
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
    expect(JSON.parse(row['agentOutput'] as string)).toEqual(agentOutput);
  }, 90_000);

  // ── IP snapshot UPDATED → patch InvestorProfileSnapshot row ──────

  it('updates InvestorProfileSnapshot on INVESTOR_PROFILE_SNAPSHOT_UPDATED', async () => {
    // Pin a per-test userId onto the shared context (identity is context-only;
    // the projector keys on ctx.userId).
    const userId = `proj-ip-upd-user-${randomUUID()}`;
    ctx.userId = userId;

    // Base agentOutput satisfying every required InvestorProfileSnapshotSchema field.
    // Composite shape: { decisionId, goals: GoalInterpretation, risk: RiskEvaluation, metadata }
    // Per-test variants override risk sub-fields (riskScore / riskWillingness).
    const baseAgentOutput = {
      decisionId: 'dec-integ-upd',
      goals: {
        goals: ['retirement'],
        timeHorizon: 'LONG_TERM',
        riskWillingness: 'MODERATE',
        confidence: 0.8,
      },
      risk: {
        riskCategory: 'MODERATE' as const,
        regulatoryFlags: [],
        suitabilityAssessment: 'integration projection update test',
        confidence: 0.8,
        riskScore: 0, // overridden per-variant below
      },
      metadata: {
        durationMs: 1500,
        modelTiers: ['haiku', 'sonnet'],
      },
    };

    // Seed via CREATED first (composite shape — riskScore inside risk sub-object).
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'INVESTOR_PROFILE_SNAPSHOT_CREATED',
      subject: {
        agentOutput: { ...baseAgentOutput, risk: { ...baseAgentOutput.risk, riskScore: 30 } },
        sourceEventId: `seed-${randomUUID()}`,
        __version: 1,
      },
    });
    const seeded = await table.waitForItem({
      table: 'decision-workflow-ctrl',
      pk: `InvestorProfileSnapshot#${ctx.tenantId}#${userId}`,
      sk: 'InvestorProfileSnapshot',
      timeoutMs: 60_000,
    });
    // riskScore lives inside agentOutput.risk (composite shape)
    expect((JSON.parse(seeded['agentOutput'] as string) as { risk: { riskScore: number } }).risk.riskScore).toBe(30);
    const seededUpdatedAt = seeded['updatedAt'];

    // Then publish UPDATED with a different riskScore + a distinguishing
    // schema-valid field (riskWillingness) to prove the row was overwritten.
    // (Non-schema marker keys like `raised` are stripped by the producer schema
    // at the parseSubject seam, so they can't be asserted post-projection.)
    await new Promise((r) => setTimeout(r, 1_000));
    const updatedAgentOutput = {
      ...baseAgentOutput,
      goals: { ...baseAgentOutput.goals, riskWillingness: 'HIGH' },
      risk: { ...baseAgentOutput.risk, riskScore: 85 },
    };
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'INVESTOR_PROFILE_SNAPSHOT_UPDATED',
      subject: {
        agentOutput: updatedAgentOutput,
        sourceEventId: `upd-${randomUUID()}`,
        __version: 2,
      },
    });

    const updated = await table.waitForItem({
      table: 'decision-workflow-ctrl',
      pk: `InvestorProfileSnapshot#${ctx.tenantId}#${userId}`,
      sk: 'InvestorProfileSnapshot',
      predicate: (item) => {
        try {
          // riskScore is nested inside agentOutput.risk (composite schema)
          return (JSON.parse(item['agentOutput'] as string) as { risk: { riskScore: number } }).risk.riskScore === 85;
        } catch {
          return false;
        }
      },
      description: 'agentOutput.risk.riskScore advances to 85',
      timeoutMs: 60_000,
    });

    expect((JSON.parse(updated['agentOutput'] as string) as { risk: { riskScore: number } }).risk.riskScore).toBe(85);
    // riskWillingness lives inside agentOutput.goals (composite schema)
    expect((JSON.parse(updated['agentOutput'] as string) as { goals: { riskWillingness: string } }).goals.riskWillingness).toBe('HIGH');
    expect(updated['updatedAt']).not.toBe(seededUpdatedAt);
  }, 120_000);

  // ── Market snapshot UPDATED → MarketSnapshot row ──────────────────

  it('projects MarketSnapshot on MARKET_SNAPSHOT_UPDATED', async () => {
    const region = `integ-region-${randomUUID().slice(0, 8)}`;
    // Full MarketAnalysisOutputSchema — every field required by the producer
    // schema parsed at the consumer parseSubject seam (signals item shape +
    // tickersMentioned + marketOutlook + confidenceScore).
    const agentOutput = {
      signals: [
        {
          type: 'MOMENTUM',
          ticker: 'SPY',
          sentiment: 'BULLISH' as const,
          confidence: 0.7,
          source: 'projection-test',
        },
      ],
      tickersMentioned: ['SPY'],
      marketOutlook: 'projection test',
      confidenceScore: 0.65,
    };

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'MARKET_SNAPSHOT_UPDATED',
      // Dry subject — MarketSnapshotSchema is { agentOutput, __version }. The
      // market `region` is region-scope identity carried in RegionContext (the
      // event context), NOT on the subject — the snapshot-projector keys the
      // MarketSnapshot row on ctx.region. (Schema-verified: region is not a
      // MarketSnapshotSchema field.)
      subject: {
        agentOutput,
        __version: 1,
      },
      context: { region },
    });

    const row = await table.waitForItem({
      table: 'decision-workflow-ctrl',
      pk: `MarketSnapshot#${region}`,
      sk: 'MarketSnapshot',
      timeoutMs: 60_000,
    });

    expect(row['__typename']).toBe('MarketSnapshot');
    expect(row['region']).toBe(region);
    expect(JSON.parse(row['agentOutput'] as string)).toEqual(agentOutput);
  }, 90_000);

  // ── Negative: missing agentOutput → no row written ──────────────

  it('does NOT project a row when MARKET_SNAPSHOT_UPDATED is missing subject.agentOutput', async () => {
    // The projector keys the MarketSnapshot row on ctx.region (region is RegionContext,
    // not a subject field). Pin a per-test region onto the shared context so this
    // negative assertion resolves against the row the handler WOULD write.
    const region = `integ-noagent-${randomUUID().slice(0, 8)}`;
    ctx.region = region;

    // putRawEvent: a deliberate UNVALIDATED send — the typed putEvent overload parses
    // the subject (MarketSnapshotSchema) BEFORE the network call, so it cannot deliver
    // a schema-invalid payload to the deployed handler. putRawEvent bypasses that guard
    // so the missing-agentOutput payload reaches the handler and exercises its
    // fault-tolerance path end-to-end (parseSubject ZodError → NotRetryableError → no
    // row written, observability-surfaced).
    await eb.putRawEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'MARKET_SNAPSHOT_UPDATED',
      detail: {
        // agentOutput intentionally omitted → parseSubject(MarketSnapshotSchema)
        // throws a ZodError at the seam; materializeToTable surfaces it through
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
