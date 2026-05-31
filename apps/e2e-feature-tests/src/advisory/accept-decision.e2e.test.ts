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
  withDecision,
  emitDecisionSnapshot,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '..';

describe('scenario 6 — investor accepts decision and sees it executed', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let decisionId: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    const result = await applyFixtures(ctx, tenant, [
      onboarded(),
      funded({ cashBalanceCents: 1_000_000 }),
      withDecision({
        trigger: 'INITIAL_ALLOCATION',
        proposedTrades: [{ symbol: 'VTI', side: 'BUY', quantityOrAmountCents: 500_000 }],
      }),
    ]);
    decisionId = result.decisionId as string;
  }, 600_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('confirmed decision surfaces as CONFIRMED; downstream fill surfaces in ledger portfolio', async () => {
    const bff = bffClient(ctx, tenant);
    const eb = new EventBridgeClient(ctx);

    // Wait for the decision to materialise in advisory-bff before confirming.
    // withDecision() publishes DECISION_PACKET_CREATED but does not poll for
    // materialisation — the SQS→Lambda→DDB path may still be in-flight.
    await waitForGraphQL<{ getDecision: { decisionId: string; status: string } | null }>(
      bff.advisory,
      `query GetDecision($decisionId: ID!) { getDecision(decisionId: $decisionId) { decisionId status } }`,
      { decisionId },
      (r) => r.getDecision != null,
      { timeoutMs: 60_000 },
    );

    // TRIGGER 1: user confirms the decision.
    // Post-w3 confirmDecision is INTENT-ONLY: it writes a UserConfirmation row +
    // emits USER_CONFIRMED, and returns the pre-action readback row (still
    // PENDING / version 1) — it does NOT write the terminal status. So we assert
    // the mutation ran (echoes the decisionId), NOT that the response is
    // CONFIRMED. The real confirm→task-token→CONFIRMED loop is covered by the
    // Playwright new-investor-happy-path journey + the advisory-bff integration
    // suite; here we model the producer's reaction synthetically below.
    const confirm = await bff.advisory.mutate<{
      confirmDecision: { decisionId: string; status: string; confirmedAt: string | null; version: number };
    }>(
      `mutation ConfirmDecision($decisionId: ID!) {
         confirmDecision(decisionId: $decisionId) {
           decisionId
           status
           confirmedAt
           version
         }
       }`,
      { decisionId },
    );
    expect(confirm.confirmDecision.decisionId).toBe(decisionId);

    // Model the producer (decision-workflow-ctrl) reacting to USER_CONFIRMED:
    // it increments __version and emits a terminal DECISION_PACKET_UPDATED with
    // status CONFIRMED. The versioned projection (v2 > v1) drives the read-model
    // row to CONFIRMED — the only path to terminal status post-w3.
    await emitDecisionSnapshot(eb, tenant, {
      decisionId,
      trigger: 'INITIAL_ALLOCATION',
      status: 'CONFIRMED',
      version: 2,
      proposedTrades: [{ symbol: 'VTI', side: 'BUY', quantityOrAmountCents: 500_000 }],
      confirmedAt: new Date().toISOString(),
    });

    // ASSERT: the read model surfaces the terminal CONFIRMED status.
    await waitForGraphQL<{ getDecision: { decisionId: string; status: string } | null }>(
      bff.advisory,
      `query GetDecision($decisionId: ID!) { getDecision(decisionId: $decisionId) { decisionId status } }`,
      { decisionId },
      (r) => r.getDecision?.status === 'CONFIRMED',
      { timeoutMs: 60_000 },
    );

    // TRIGGER 2: simulate the downstream fill (bypass real broker pipeline).
    // Publish directly on the ledger bus so ledger-ctrl's Ingress picks it
    // up — publishing on the execution bus would require the ledger-adpt
    // adapter rule to forward, which doesn't match integration-test: source.
    // Field names must match ledger-ctrl's RecordFill schema: fillPrice is
    // per-share dollars (not cents), filledAt is required ISO timestamp.
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_FILLED',
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        orderId: `e2e-order-${Date.now()}`,
        decisionId,
        symbol: 'VTI',
        side: 'BUY',
        quantity: 10,
        fillPrice: 200,
        filledAt: new Date().toISOString(),
      },
    });

    // ASSERT: ledger-bff portfolio eventually reflects the fill
    const portfolio = await waitForGraphQL<{
      getPortfolio: { cashBalanceCents: number; positions: Array<{ symbol: string; quantity: number }>; totalValueCents: number | null };
    }>(
      bff.ledger,
      `query Portfolio { getPortfolio { cashBalanceCents positions { symbol quantity } totalValueCents } }`,
      {},
      (r) => (r.getPortfolio?.positions ?? []).some((p) => p.symbol === 'VTI' && p.quantity > 0),
      { timeoutMs: 120_000 },
    );
    expect(portfolio.getPortfolio.positions.find((p) => p.symbol === 'VTI')?.quantity).toBeGreaterThan(0);

    // ASSERT: advisory-bff decision status is still CONFIRMED
    const decision = await bff.advisory.query<{ getDecision: { decisionId: string; status: string } | null }>(
      `query GetDecision($decisionId: ID!) { getDecision(decisionId: $decisionId) { decisionId status } }`,
      { decisionId },
    );
    expect(decision.getDecision?.status).toBe('CONFIRMED');
  });
});
