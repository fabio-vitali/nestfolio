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
  withLiveDecision,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '..';
import type { DecisionHistoryResponse } from '../helpers/graphql-types';
import { AgentTraceTrap } from '../helpers/agent-trace-trap';

describe('scenario 12 — portfolio drift surfaces a rebalance decision', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let portfolioTrap: AgentTraceTrap<'portfolioEngine'>;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    portfolioTrap = await AgentTraceTrap.arm(ctx, 'portfolioEngine');
    await applyFixtures(ctx, tenant, [
      onboarded(),
      funded({ cashBalanceCents: 2_000_000 }),
      withHoldings([
        { symbol: 'VTI', quantity: 50, fillPrice: 200 },
        { symbol: 'BND', quantity: 10, fillPrice: 80 },
      ]),
      // Drive the first decision cycle to completion so the MandateSnapshot
      // projection materialises before the test body emits PORTFOLIO_DRIFT_DETECTED.
      // Without this, decision-workflow-ctrl's SF hits LookupMandateSnapshot
      // before the projector has written the row and fails the
      // $.Item.operatingMode.S JSONPath extraction.
      withLiveDecision(),
    ]);
  }, 300_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('PORTFOLIO_DRIFT_DETECTED triggers a rebalance decision', async () => {
    const bff = bffClient(ctx, tenant);
    const eb = new EventBridgeClient(ctx);

    // TRIGGER: synthetic drift detection on advisory bus. decision-workflow-ctrl
    // starts the Step Function that runs the 4-agent pipeline and publishes
    // DECISION_PACKET_CREATED; advisory-bff projects that into the
    // DecisionPacket surfaced by getDecisionHistory. The SF keys decisionId
    // on ctx.eventId so envelope correlationId matches the DecisionPacket
    // decisionId. (advisory-ctrl was removed 2026-04-30 in Spec 2.)
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'PORTFOLIO_DRIFT_DETECTED',
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        driftPercent: 12.5,
        positionsOutOfBand: [{ symbol: 'VTI', targetWeight: 0.6, actualWeight: 0.75 }],
      },
    });

    // ASSERT: a decision with trigger PORTFOLIO_DRIFT_DETECTED surfaces
    const history = await waitForGraphQL<DecisionHistoryResponse>(
      bff.advisory,
      `query History { getDecisionHistory(limit: 10) { items { decisionId trigger status } nextCursor } }`,
      {},
      (r) => r.getDecisionHistory.items.some((d) => d.trigger === 'PORTFOLIO_DRIFT_DETECTED'),
      { timeoutMs: 240_000, intervalMs: 5_000 },
    );

    const decision = history.getDecisionHistory.items.find((d) => d.trigger === 'PORTFOLIO_DRIFT_DETECTED');
    expect(decision).toBeDefined();
    expect(decision!.decisionId).toEqual(expect.any(String));

    const traces = await portfolioTrap.waitFor({
      correlationId: decision!.decisionId,
      timeoutMs: 240_000,
    });
    const envelope = traces[0].envelope;

    expect(envelope.status).toBe('success');
    expect(envelope.errors).toHaveLength(0);
    expect(envelope.toolCalls).toHaveLength(0);
    expect(envelope.llmCalls.length).toBeGreaterThanOrEqual(1);

    const models = new Set(envelope.llmCalls.map((l) => l['gen_ai.request.model']));
    expect(
      models.has('us.anthropic.claude-opus-4-6-v1') ||
        models.has('us.anthropic.claude-sonnet-4-6'),
    ).toBe(true);

    expect(envelope['gen_ai.invocation.latency_ms']).toBeLessThan(portfolioTrap.getLatencyBudget());
  });
});
